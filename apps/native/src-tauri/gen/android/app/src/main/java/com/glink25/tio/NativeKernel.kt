package com.glink25.tio

import android.content.Context
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.function
import com.dokar.quickjs.binding.asyncFunction
import kotlinx.coroutines.delay
import java.security.MessageDigest
import java.util.UUID
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.net.URL
import java.net.HttpURLConnection

internal object NativeKernel {
    init { System.loadLibrary("tio_native") }
    external fun nativeCall(path: String, request: String): String

    class Failure(val code: String) : RuntimeException(code)
    private const val BUDGET_MILLIS = 8 * 60 * 1000L

    suspend fun needsRetry(context: Context, stopped: () -> Boolean): Boolean = withTimeout(BUDGET_MILLIS) {
        val root = File(context.applicationInfo.dataDir)
        val database = File(root, "catalog.sqlite3")
        if (!database.exists()) return@withTimeout false
        val deadline = android.os.SystemClock.elapsedRealtime() + BUDGET_MILLIS
        val selectedReply = JSONObject(nativeCall(database.path, "{\"action\":\"kernelBegin\"}"))
        if (selectedReply.has("error")) throw Failure(selectedReply.getString("error"))
        val selected = selectedReply.getJSONObject("value")
        val lease = if (selected.isNull("token")) null else selected.getString("token")
        val cancelled = {
            stopped() || android.os.SystemClock.elapsedRealtime() >= deadline ||
                JSONObject(nativeCall(database.path, "{\"action\":\"kernelCancelled\"}")).optBoolean("value", true)
        }
        val locks = mutableSetOf<String>()
        var runtime: QuickJs? = null
        try {
            val js = QuickJs.create(Dispatchers.IO)
            runtime = js
            js.evaluationTimeoutMillis = BUDGET_MILLIS
            js.function("tioKernelInfo") { _: Array<Any?> ->
                JSONObject().put("revision", selected.getLong("revision"))
                    .put("sha256", selected.getString("sha256")).toString()
            }
            js.function("tioUUID") { _: Array<Any?> -> UUID.randomUUID().toString() }
            js.function<String, String>("tioEncode") { JSONArray(it.toByteArray().map { byte -> byte.toInt() and 255 }).toString() }
            js.function<String, String>("tioDecode") {
                val array = JSONArray(it)
                ByteArray(array.length()) { index -> array.getInt(index).toByte() }.toString(Charsets.UTF_8)
            }
            js.function<String, String>("tioDigest") {
                val array = JSONArray(it)
                val digest = MessageDigest.getInstance("SHA-256").digest(ByteArray(array.length()) { index -> array.getInt(index).toByte() })
                JSONArray(digest.map { byte -> byte.toInt() and 255 }).toString()
            }
            js.function<String, String>("tioAtob") { Base64.decode(it, Base64.DEFAULT).toString(Charsets.ISO_8859_1) }
            js.function<String, String>("tioBtoa") { Base64.encodeToString(it.toByteArray(Charsets.ISO_8859_1), Base64.NO_WRAP) }
            js.asyncFunction<Double, Unit>("tioSleep") { delay(it.toLong().coerceAtLeast(0)) }
            js.evaluate<Unit>(context.assets.open("tio-bootstrap.js").bufferedReader().use { it.readText() } + "\nvoid 0;")
            js.function<String, String>("tioNative") { nativeCall(database.path, it) }
            js.function("tioCredential") { args: Array<Any?> ->
                try {
                    val value = CredentialStore(context).perform(args[0] as String, args[1] as String)
                    JSONObject().put("value", value ?: JSONObject.NULL).toString()
                } catch (_: Exception) { JSONObject().put("error", "unavailable").toString() }
            }
            js.function("tioCancelled") { _: Array<Any?> -> cancelled() }
            js.function("tioLock") { args: Array<Any?> ->
                val name = args[0] as String
                val token = args[1] as String
                val reply = JSONObject(nativeCall(database.path,
                    JSONObject().put("action", "lock").put("name", name).put("token", token).toString()))
                check(!reply.has("error"))
                if (token.isNotEmpty()) { locks.remove(token); null }
                else reply.optString("value").takeUnless { reply.isNull("value") }?.also { locks.add(it) }

            }
            js.function("tioFetch") { args: Array<Any?> ->
                val url = URL(args[0] as String)
                val origin = JSONObject(nativeCall(database.path, "{\"action\":\"authOrigin\"}")).getString("value").trimEnd('/')
                require(url.protocol == "https" &&
                    (url.host == "api.github.com" || url.toString() == origin + "/api/github/refresh"))
                check(!cancelled())
                val fields = JSONObject(args[1] as String)
                val connection = url.openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 10000
                    connection.readTimeout = 10000
                    connection.instanceFollowRedirects = false
                    connection.requestMethod = fields.optString("method", "GET")
                    val headers = fields.optJSONObject("headers") ?: JSONObject()
                    for (name in headers.keys()) connection.setRequestProperty(name, headers.getString(name))
                    if (fields.has("body")) {
                        connection.doOutput = true
                        connection.outputStream.use { it.write(fields.getString("body").toByteArray()) }
                    }
                    val status = connection.responseCode
                    val bytes = (if (status < 400) connection.inputStream else connection.errorStream)
                        ?.use { stream ->
                            val output = java.io.ByteArrayOutputStream()
                            val buffer = ByteArray(16384)
                            while (true) {
                                check(!cancelled())
                                val count = stream.read(buffer)
                                if (count < 0) break
                                require(output.size() + count <= 32 * 1024 * 1024)
                                output.write(buffer, 0, count)
                            }
                            output.toByteArray()
                        } ?: ByteArray(0)
                    require(bytes.size <= 32 * 1024 * 1024)
                    val responseHeaders = JSONObject()
                    for ((name, values) in connection.headerFields) {
                        if (name != null) responseHeaders.put(name.lowercase(), values.joinToString(", "))
                    }
                    JSONObject().put("status", status).put("headers", responseHeaders)
                        .put("body", bytes.toString(Charsets.UTF_8)).toString()
                } finally { connection.disconnect() }
            }
            val kernel = if (selected.isNull("path")) {
                context.assets.open("tio-kernel.js").bufferedReader().use { it.readText() }
            } else File(selected.getString("path")).readText()
            js.evaluate<Unit>(kernel + "\nvoid 0;")
            js.evaluate<Unit>("globalThis.tioBackgroundResult = JSON.stringify(await TioKernel.runBackground());", asModule = true)
            JSONObject(js.evaluate<String>("globalThis.tioBackgroundResult")).getBoolean("retry")

        } finally {
            try { runtime?.close() } finally {
                for (token in locks) nativeCall(database.path,
                    JSONObject().put("action", "lock").put("token", token).toString())
                if (lease != null) nativeCall(database.path,
                    JSONObject().put("action", "kernelEnd").put("token", lease).toString())
            }
        }
    }
}
