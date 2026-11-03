$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchain = Join-Path $projectRoot '.data\android-toolchain'

if (-not (Test-Path (Join-Path $toolchain 'jdk\bin\java.exe'))) {
    throw 'Java local nao encontrado. Execute npm run android:setup -- -AcceptSdkLicenses.'
}

# Somente o processo atual: nao altera PATH ou JAVA_HOME globais do Windows.
$env:JAVA_HOME = Join-Path $toolchain 'jdk'
$env:ANDROID_HOME = Join-Path $toolchain 'sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = Join-Path $toolchain 'android-user'
$env:GRADLE_USER_HOME = Join-Path $toolchain 'gradle-cache'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$toolchain\gradle-8.13\bin;$env:PATH"
