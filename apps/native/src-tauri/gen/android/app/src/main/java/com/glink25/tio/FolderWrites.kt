package com.glink25.tio

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.OverlappingFileLockException
import java.security.MessageDigest
import java.util.UUID

/** Low-level SAF publication journal. Business commits remain in the shared repository journal. */
internal class FolderWrites(context: Context) {
    class Failure(val code: String) : Exception(code)
    interface Files {
        fun read(path: String): ByteArray?
        fun write(path: String, bytes: ByteArray)
        fun rename(path: String, name: String)
        fun remove(path: String)
        fun canRename(path: String): Boolean
    }
    private val root = File(context.noBackupFilesDir, "folder-writes")
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }
    private fun fingerprint(files: Files, path: String) = files.read(path)?.let { hash(it) }
    private fun atomic(file: File, value: JSONObject) {
        val writer = AtomicFile(file)
        val stream = writer.startWrite()
        try { stream.write(value.toString().toByteArray(Charsets.UTF_8)); writer.finishWrite(stream) }
        catch (error: Exception) { writer.failWrite(stream); throw error }
    }
    fun <T> access(grant: String, workspace: String, files: Files, recoverPending: Boolean = true, work: (File) -> T): T {
        require(grant.matches(Regex("[a-f0-9]{64}")))
        require(workspace.matches(Regex("[A-Za-z0-9_-]+")))
        val directory = File(File(root, grant), workspace).apply { mkdirs() }
        RandomAccessFile(File(directory, "workspace.lock"), "rw").channel.use { channel ->
            val deadline = System.nanoTime() + 15_000_000_000L
            var lock: java.nio.channels.FileLock? = null
            while (lock == null) {
                lock = try { channel.tryLock() } catch (_: OverlappingFileLockException) { null }
                if (lock == null) {
                    if (System.nanoTime() >= deadline) throw Failure("pending")
                    Thread.sleep(25)
                }
            }
            lock.use {
                // AtomicFile may restore an interrupted journal replacement from its backup.
                val records = directory.listFiles().orEmpty().map { it.name.removeSuffix(".bak").removeSuffix(".new") }
                    .filter { it.matches(Regex("[a-f0-9]{64}\\.json")) }.distinct()
                for (name in if (recoverPending) records else emptyList()) {
                    val file = File(directory, name)
                    if (!file.exists() && !File(file.path + ".bak").exists()) {
                        // A killed initial journal write cannot have started provider I/O.
                        AtomicFile(file).delete()
                        continue
                    }
                    val raw = AtomicFile(file).openRead().use { it.readBytes().toString(Charsets.UTF_8) }
                    recover(file, JSONObject(raw), files)
                }
                return work(directory)
            }
        }
    }
    fun write(directory: File, path: String, bytes: ByteArray, files: Files) {
        val before = fingerprint(files, path)
        val after = hash(bytes)
        if (before == after) return
        if (before != null && !files.canRename(path)) throw Failure("unavailable")
        val token = UUID.randomUUID().toString()
        val parent = path.substringBeforeLast('/')
        val temp = "$parent/.tio-publish-$token.tmp"
        val backup = "$parent/.tio-before-$token.tmp"
        val record = JSONObject().put("format", 1).put("path", path).put("temp", temp).put("backup", backup)
            .put("before", before ?: JSONObject.NULL).put("after", after)
        val journal = File(directory, hash(path.toByteArray(Charsets.UTF_8)) + ".json")
        atomic(journal, record)
        files.write(temp, bytes)
        if (!files.canRename(temp)) {
            files.remove(temp); AtomicFile(journal).delete(); throw Failure("unavailable")
        }
        recover(journal, record, files)
        if (fingerprint(files, path) != after) throw Failure("unavailable")
    }
    private fun recover(journal: File, record: JSONObject, files: Files) {
        require(record.getInt("format") == 1)
        val path = record.getString("path")
        require(path.startsWith("workspaces/" + journal.parentFile!!.name + "/"))
        val temp = record.getString("temp")
        val backup = record.getString("backup")
        val parent = path.substringBeforeLast('/')
        require(temp.substringBeforeLast('/') == parent && backup.substringBeforeLast('/') == parent)
        require(temp.substringAfterLast('/').matches(Regex("\\.tio-publish-[a-f0-9-]{36}\\.tmp")))
        require(backup.substringAfterLast('/').matches(Regex("\\.tio-before-[a-f0-9-]{36}\\.tmp")))
        val before = if (record.isNull("before")) null else record.getString("before")
        val after = record.getString("after")
        require(after.matches(Regex("[a-f0-9]{64}")) && (before == null || before.matches(Regex("[a-f0-9]{64}"))))
        val current = fingerprint(files, path)
        val old = fingerprint(files, backup)
        val staged = fingerprint(files, temp)
        fun cleanup() {
            if (fingerprint(files, backup) != null) {
                if (fingerprint(files, backup) != before) throw Failure("conflict")
                files.remove(backup)
            }
            if (fingerprint(files, temp) != null) files.remove(temp)
            AtomicFile(journal).delete()
        }
        if (current == after) { cleanup(); return }
        if (current == before && old == null) {
            // Incomplete staging never truncates the authoritative file. Let the workspace journal retry.
            if (staged != after || !files.canRename(temp)) { cleanup(); return }
            if (before != null) files.rename(path, backup.substringAfterLast('/'))
        } else if (current == null && before != null && old == before) {
            if (staged != after) {
                files.rename(backup, path.substringAfterLast('/'))
                if (fingerprint(files, path) != before) throw Failure("conflict")
                cleanup(); return
            }
        } else throw Failure("conflict")
        // A provider must preserve the requested name. A concurrent external file is a conflict.
        if (fingerprint(files, path) != null) throw Failure("conflict")
        files.rename(temp, path.substringAfterLast('/'))
        if (fingerprint(files, path) != after) throw Failure("conflict")
        cleanup()
    }
}
