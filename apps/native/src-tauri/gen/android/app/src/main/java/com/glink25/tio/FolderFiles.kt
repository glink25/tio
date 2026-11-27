package com.glink25.tio

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest

internal class FolderFiles(context: Context) {
    private val resolver = context.contentResolver

    fun grantId(uri: Uri) = MessageDigest.getInstance("SHA-256")
        .digest(uri.toString().toByteArray()).joinToString("") { "%02x".format(it) }

    fun call(args: JSONObject): JSONObject {
        val reply = JSONObject()
        return try {
            reply.put("value", access(args) ?: JSONObject.NULL)
        } catch (error: Exception) {
            reply.put("error", errorCode(error))
        }
    }

    companion object {
        fun errorCode(error: Exception): String = when (error) {
            is FolderWrites.Failure -> error.code
            is SecurityException -> "permission"
            is IllegalArgumentException -> "invalid"
            else -> "unavailable"
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
            if (cursor.extras.getBoolean(DocumentsContract.EXTRA_LOADING)) throw FolderWrites.Failure("pending")
            entries
        } ?: throw IOException()
    }

    private val writes = FolderWrites(context)
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
        if (action == "access") return true
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
