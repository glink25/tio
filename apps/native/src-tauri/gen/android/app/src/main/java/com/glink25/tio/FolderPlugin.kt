package com.glink25.tio

import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors

@TauriPlugin
class FolderPlugin(private val activity: Activity) : Plugin(activity) {
    private val resolver = activity.contentResolver
    private val io = Executors.newSingleThreadExecutor()
    private val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    private val files = FolderFiles(activity)

    private fun answer(invoke: Invoke, work: () -> Any?) {
        val response = JSObject()
        try {
            response.put("value", work() ?: JSONObject.NULL)
        } catch (e: Exception) {
            response.put("error", FolderFiles.errorCode(e))
        }
        invoke.resolve(response)
    }

    private val credentials = CredentialStore(activity)

    @Command
    fun credential(invoke: Invoke) {
        val args = invoke.getArgs()
        io.execute { answer(invoke) { credentials.perform(args.getString("action"), args.optString("value")) } }
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
        io.execute { invoke.resolve(JSObject(files.call(args).toString())) }
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
                JSONObject().put("kind", "native-folder").put("id", files.grantId(uri)).put("name", name)
            }
        }
    }

}
