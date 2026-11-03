$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')

$projectRoot = Split-Path -Parent $PSScriptRoot
$android = Join-Path $projectRoot 'apps\android'
& node (Join-Path $PSScriptRoot 'sync-player.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao sincronizar o renderizador compartilhado.' }
$gradle = Join-Path $projectRoot '.data\android-toolchain\gradle-8.13\bin\gradle.bat'

# Gera tambem o Wrapper oficial, com checksum fixado, para builds posteriores.
& $gradle --no-daemon --console=plain -p $android wrapper `
    --gradle-version 8.13 --distribution-type bin `
    --gradle-distribution-sha256-sum '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78' `
    assembleDebug lintDebug
if ($LASTEXITCODE -ne 0) { throw 'O build Android ou a verificacao de lint falhou.' }

Write-Host "APK de teste: $android\app\build\outputs\apk\debug\app-debug.apk"
