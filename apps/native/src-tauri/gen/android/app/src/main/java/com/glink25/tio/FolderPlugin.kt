package com.glink25.tio

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Base64
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.Executors

@TauriPlugin
class FolderPlugin(private val activity: Activity) : Plugin(activity) {
    private val resolver = activity.contentResolver
    private val io = Executors.newSingleThreadExecutor()
    private val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    private fun grantId(uri: Uri) = MessageDigest.getInstance("SHA-256")
        .digest(uri.toString().toByteArray()).joinToString("") { "%02x".format(it) }

    private fun answer(invoke: Invoke, work: () -> Any?) {
        val response = JSObject()
        try {
            response.put("value", work() ?: JSONObject.NULL)
        } catch (e: Exception) {
            response.put("error", when (e) {
                is HostUpdate.Failure -> e.code
                is FolderWrites.Failure -> e.code
                is SecurityException -> "permission"
                is IllegalArgumentException -> "invalid"
                else -> "unavailable"
            })
        }
        invoke.resolve(response)
    }

    private val credentials = CredentialStore(activity)

    @Command
    fun credential(invoke: Invoke) {
        val args = invoke.getArgs()
        io.execute { answer(invoke) { credentials.perform(args.getString("action"), args.optString("value")) } }
    }

    private val hostUpdater = HostUpdate(activity)

    @Command
    fun hostUpdate(invoke: Invoke) {
        val args = invoke.getArgs()
        io.execute { answer(invoke) { hostUpdater.perform(args) } }
    }

    @Command
    fun clearStorage(invoke: Invoke) {
        io.execute { answer(invoke) {
            val manager = androidx.work.WorkManager.getInstance(activity)
            manager.cancelUniqueWork("tio-sync").result.get()
            manager.cancelUniqueWork("tio-sync-now").result.get()
            for (permission in resolver.persistedUriPermissions) {
                var modes = 0
                if (permission.isReadPermission) modes = modes or Intent.FLAG_GRANT_READ_URI_PERMISSION
                if (permission.isWritePermission) modes = modes or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                resolver.releasePersistableUriPermission(permission.uri, modes)
            }
            val journals = java.io.File(activity.noBackupFilesDir, "folder-writes")
            if (journals.exists() && !journals.deleteRecursively()) throw IOException()
            null
        } }
    }

    @Command
    fun folder(invoke: Invoke) {
        val args = invoke.getArgs()
        if (args.getString("action") == "pick") {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(flags or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            activity.runOnUiThread { startActivityForResult(invoke, intent, "selected") }
            return
        }
        io.execute { answer(invoke) { access(args) } }
    }

    @ActivityCallback
    fun selected(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().apply { put("error", "cancelled") })
            return
        }
        io.execute {
            answer(invoke) {
                resolver.takePersistableUriPermission(uri, result.data!!.flags and flags)
                val root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
                val name = resolver.query(root, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                } ?: throw IOException()
                JSONObject().put("kind", "native-folder").put("id", grantId(uri)).put("name", name)
            }
        }
    }

    private data class Entry(val uri: Uri, val name: String, val directory: Boolean, val flags: Int)

    private fun children(tree: Uri, parent: Uri): List<Entry> {
        val listing = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent))
        val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS)
        return resolver.query(listing, columns, null, null, null)?.use { cursor ->
            val entries = mutableListOf<Entry>()
            while (cursor.moveToNext()) {
                entries.add(Entry(DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0)),
                    cursor.getString(1), cursor.getString(2) == Document.MIME_TYPE_DIR, cursor.getInt(3)))
            }
            if (cursor.extras.getBoolean(DocumentsContract.EXTRA_LOADING)) throw IOException("Listing pending")
            entries
        } ?: throw IOException()
    }

    private val writes = FolderWrites(activity)
    private fun access(args: JSONObject): Any? {
        val action = args.getString("action")
        if (action == "access" || action == "workspaces") return accessRaw(args)
        val parts = args.getString("path").trimEnd('/').split('/')
        if (parts.size == 1 && action == "list") return accessRaw(args)
        require(parts.size >= 2 && parts[0] == "workspaces")
        val grant = args.getString("grant")
        val files = object : FolderWrites.Files {
            private fun call(action: String, path: String, data: String? = null) =
                accessRaw(JSONObject().put("grant", grant).put("action", action).put("path", path).put("data", data))
            override fun read(path: String) = (call("read", path) as? String)?.let { Base64.decode(it, Base64.DEFAULT) }
            override fun write(path: String, bytes: ByteArray) { call("write", path, Base64.encodeToString(bytes, Base64.NO_WRAP)) }
            override fun rename(path: String, name: String) { call("rename", path, name) }
            override fun remove(path: String) { call("remove", path) }
            override fun canRename(path: String) = call("renameCap", path) == true
        }
        val removeWorkspace = action == "remove" && parts.size == 2
        return writes.access(grant, parts[1], files, !removeWorkspace) { directory ->
            if (action == "write") {
                writes.write(directory, args.getString("path"), Base64.decode(args.getString("data"), Base64.DEFAULT), files)
                null
            } else {
                val result = accessRaw(args)
                if (removeWorkspace) directory.listFiles().orEmpty()
                    .filter { it.name != "workspace.lock" }.forEach { it.delete() }
                result
            }
        }
    }
    private fun accessRaw(args: JSONObject): Any? {
        val grant = args.getString("grant")
        val tree = resolver.persistedUriPermissions.firstOrNull {
            it.isReadPermission && it.isWritePermission && grantId(it.uri) == grant
        }?.uri ?: throw SecurityException()
        val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val action = args.getString("action")
        if (action == "access") { children(tree, root); return true }
        val parts = if (action == "workspaces") listOf("workspaces") else args.getString("path").trimEnd('/').split('/')
        require(parts.first() == "workspaces" && parts.none { it.isEmpty() || it == "." || it == ".." || it.contains('\\') || it.contains('\u0000') })
        var current = root
        var last: Entry? = null
        for ((index, part) in parts.withIndex()) {
            val matches = children(tree, current).filter { it.name == part }
            if (matches.size > 1) throw IOException("Ambiguous document")
            val entry = matches.firstOrNull()
            if (entry != null) {
                if (index < parts.lastIndex && !entry.directory) throw IOException()
                current = entry.uri
                last = entry
            } else if (action == "write") {
                val mime = if (index < parts.lastIndex) Document.MIME_TYPE_DIR else "application/octet-stream"
                current = DocumentsContract.createDocument(resolver, current, mime, part) ?: throw IOException()
            } else {
                return when(action) {
                    "list", "workspaces" -> JSONArray()
                    "read", "remove" -> null
                    "renameCap" -> false
                    else -> throw IllegalArgumentException()
                }
            }
        }
        return when (action) {
            "workspaces" -> JSONArray(children(tree,current).filter { it.directory && it.name.matches(Regex("[A-Za-z0-9_-]+")) }.map { it.name }.sorted())
            "list" -> {
                val results = mutableListOf<String>()
                fun walk(parent: Uri, prefix: String) {
                    for (child in children(tree, parent)) {
                        val path = prefix + "/" + child.name
                        if (child.directory) walk(child.uri, path) else results.add(path)
                    }
                }
                walk(current, parts.joinToString("/"))
                JSONArray(results.sorted())
            }
            "read" -> resolver.openInputStream(current)?.use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) } ?: throw IOException()
            "write" -> {
                val bytes = Base64.decode(args.getString("data"), Base64.DEFAULT)
                resolver.openOutputStream(current, "wt")?.use { it.write(bytes) } ?: throw IOException()
                null
            }
            "renameCap" -> ((last?.flags ?: 0) and Document.FLAG_SUPPORTS_RENAME) != 0
            "rename" -> {
                val name = args.getString("data")
                require(name.isNotEmpty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\') && !name.contains('\u0000'))
                if (((last?.flags ?: 0) and Document.FLAG_SUPPORTS_RENAME) == 0) throw IOException("Rename unavailable")
                DocumentsContract.renameDocument(resolver, current, name) ?: throw IOException()
                null
            }
            "remove" -> { if (!DocumentsContract.deleteDocument(resolver, current)) throw IOException(); null }
            else -> throw IllegalArgumentException()
        }
    }
}
