package com.glink25.tio

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

internal class HostUpdate(private val activity: Activity) {
    class Failure(val code: String) : Exception(code)

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> =
        (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)
            ?.map { it.toCharsString() }?.toSet() ?: emptySet()

    @Suppress("DEPRECATION")
    private fun validate(args: JSONObject): File {
        val directory = File(activity.cacheDir, "host-updates").canonicalFile
        val file = File(args.getString("path")).canonicalFile
        if (file.parentFile != directory || !file.name.matches(Regex("[a-f0-9]{64}\\.apk")))
            throw Failure("invalid")
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val manager = activity.packageManager
        val candidate = manager.getPackageArchiveInfo(file.path, flags) ?: throw Failure("invalid")
        val current = manager.getPackageInfo(activity.packageName, flags)
        val code = if (Build.VERSION.SDK_INT >= 28) candidate.longVersionCode else candidate.versionCode.toLong()
        val currentCode = if (Build.VERSION.SDK_INT >= 28) current.longVersionCode else current.versionCode.toLong()
        if (candidate.packageName != activity.packageName || candidate.versionName != args.getString("version") ||
            code != args.getLong("build") || code <= currentCode || candidate.applicationInfo!!.minSdkVersion > Build.VERSION.SDK_INT)
            throw Failure("incompatible")
        val installed = signers(current)
        val incoming = signers(candidate)
        if (installed.isEmpty() || incoming.isEmpty()) throw Failure("signature")
        val same = installed == incoming
        val rotated = Build.VERSION.SDK_INT >= 28 && installed.size == 1 && incoming.size == 1 &&
            candidate.signingInfo?.signingCertificateHistory?.map { it.toCharsString() }?.containsAll(installed) == true
        if (!same && !rotated) throw Failure("signature")
        return file
    }

    fun perform(args: JSONObject): JSONObject {
        if (activity.packageName != "com.glink25.tio.apk") throw Failure("invalid")
        val action = args.getString("action")
        if (action == "authorize") {
            if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
                activity.runOnUiThread {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.packageName)))
                }
            }
            return JSONObject().put("status", "ready")
        }
        if (action !in setOf("validate", "install")) throw Failure("invalid")
        val file = validate(args)
        if (action == "validate") return JSONObject().put("status", "verified")
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls())
            return JSONObject().put("status", "permission-required").put("version", args.getString("version"))
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.runOnUiThread { activity.startActivity(intent) }
        // The system owns installation and final signature verification. This is a handoff, not an installed receipt.
        return JSONObject().put("status", "install-requested").put("version", args.getString("version"))
    }
}
