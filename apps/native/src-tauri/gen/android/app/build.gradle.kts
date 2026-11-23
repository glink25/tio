import com.android.build.api.artifact.SingleArtifact
import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val nativeVersion = JsonSlurper().parseText(providers.fileContents(layout.projectDirectory.file("../../../../package.json")).asText.get()) as Map<*, *>
val nativeBuildNumber = (nativeVersion["buildNumber"] as Number).toInt()
require(nativeBuildNumber > 0)

val channel = providers.gradleProperty("tioChannel").orElse("play").get()
require(channel in setOf("play", "apk")) { "Unknown Tio distribution channel" }
val compiledChannel = providers.fileContents(layout.projectDirectory.file("../../../distribution-channel")).asText.get().trim()
require(compiledChannel == "android-$channel") { "Rust/frontend distribution channel differs from the Android application channel" }

android {
    compileSdk = 37
    namespace = "com.glink25.tio"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["tioOAuthScheme"] = if (channel == "apk") "tio-apk" else "tio"
        applicationId = if (channel == "apk") "com.glink25.tio.apk" else "com.glink25.tio"
        minSdk = 24
        targetSdk = 37
        versionCode = nativeBuildNumber
        versionName = nativeVersion["version"] as String
    }
    val releaseKeystore = System.getenv("TIO_KEYSTORE")
    signingConfigs {
        if (releaseKeystore != null) {
            create("distribution") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("TIO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("TIO_KEY_ALIAS")
                keyPassword = System.getenv("TIO_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("distribution")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_11
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("io.github.dokar3:quickjs-kt:1.0.18")
    implementation("androidx.work:work-runtime-ktx:2.11.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))

// Installation permission belongs only to the independent distribution.
if (channel == "apk") {
    androidComponents.onVariants { variant ->
        val transform = tasks.register<ApkInstallManifest>("${variant.name}ApkInstallManifest")
        variant.artifacts.use(transform)
            .wiredWithFiles(ApkInstallManifest::inputManifest, ApkInstallManifest::outputManifest)
            .toTransform(SingleArtifact.MERGED_MANIFEST)
    }
}
