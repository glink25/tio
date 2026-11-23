import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

abstract class ApkInstallManifest : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val inputManifest: RegularFileProperty
    @get:OutputFile
    abstract val outputManifest: RegularFileProperty

    @TaskAction
    fun transform() {
        val source = inputManifest.get().asFile.readText()
        require(!source.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        val position = source.indexOf("<application")
        require(position >= 0)
        outputManifest.get().asFile.apply {
            parentFile.mkdirs()
            writeText(source.substring(0, position) +
                "<uses-permission android:name=\"android.permission.REQUEST_INSTALL_PACKAGES\" />\n" +
                source.substring(position))
        }
    }
}
