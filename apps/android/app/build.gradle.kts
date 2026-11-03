import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val syncPlayerAssets by tasks.registering(Sync::class) {
    from(rootProject.layout.projectDirectory.dir("../../packages/player/src"))
    into(layout.buildDirectory.dir("generated/playerAssets/player"))
}

android {
    namespace = "com.smartframe.player"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.smartframe.player"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    sourceSets.getByName("main").assets.setSrcDirs(listOf(layout.buildDirectory.dir("generated/playerAssets")))
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

tasks.named("preBuild").configure { dependsOn(syncPlayerAssets) }

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
