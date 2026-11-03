param([switch]$AcceptSdkLicenses)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $AcceptSdkLicenses) {
    throw 'Revise https://developer.android.com/studio/terms e execute novamente com -AcceptSdkLicenses para autorizar a instalacao do SDK.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchain = Join-Path $projectRoot '.data\android-toolchain'
$downloads = Join-Path $toolchain 'downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null

function Get-VerifiedArchive {
    param([string]$Uri, [string]$Sha256, [string]$Destination)

    if (Test-Path $Destination) {
        if ((Get-FileHash -Algorithm SHA256 $Destination).Hash -ieq $Sha256) {
            Write-Host "Arquivo ja verificado: $(Split-Path -Leaf $Destination)"
            return
        }
        throw "Arquivo existente com checksum inesperado: $Destination. Nenhum binario sera executado."
    }
    Write-Host "Baixando $(Split-Path -Leaf $Destination)..."
    & curl.exe --fail --location --retry 3 --silent --show-error --output "$Destination.part" $Uri
    if ($LASTEXITCODE -ne 0) { throw "Falha no download: $Uri" }
    if ((Get-FileHash -Algorithm SHA256 "$Destination.part").Hash -ine $Sha256) {
        throw "Checksum SHA-256 invalido: $Destination.part. Download nao sera instalado."
    }
    Move-Item -LiteralPath "$Destination.part" -Destination $Destination
}

function Expand-VerifiedArchive {
    param([string]$Archive, [string]$Destination)
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & tar.exe -xf $Archive -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "Falha ao extrair $Archive" }
}

if (-not (Test-Path (Join-Path $toolchain 'jdk\bin\java.exe'))) {
    $archive = Join-Path $downloads 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip'
    Get-VerifiedArchive -Uri 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip' `
        -Sha256 'a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9' -Destination $archive
    $staging = Join-Path $toolchain 'unpack-jdk'
    Expand-VerifiedArchive -Archive $archive -Destination $staging
    $jdk = Get-ChildItem -LiteralPath $staging -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1
    if (-not $jdk) { throw 'O pacote Java nao contem o JDK esperado.' }
    Move-Item -LiteralPath $jdk.FullName -Destination (Join-Path $toolchain 'jdk')
}

$gradleChecksum = '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78'
if (-not (Test-Path (Join-Path $toolchain 'gradle-8.13\bin\gradle.bat'))) {
    $archive = Join-Path $downloads 'gradle-8.13-bin.zip'
    Get-VerifiedArchive -Uri 'https://services.gradle.org/distributions/gradle-8.13-bin.zip' -Sha256 $gradleChecksum -Destination $archive
    $staging = Join-Path $toolchain 'unpack-gradle'
    Expand-VerifiedArchive -Archive $archive -Destination $staging
    Move-Item -LiteralPath (Join-Path $staging 'gradle-8.13') -Destination (Join-Path $toolchain 'gradle-8.13')
}

$sdk = Join-Path $toolchain 'sdk'
$commandlineTools = Join-Path $sdk 'cmdline-tools\latest'
if (-not (Test-Path (Join-Path $commandlineTools 'bin\sdkmanager.bat'))) {
    $archive = Join-Path $downloads 'commandlinetools-win-15859902_latest.zip'
    Get-VerifiedArchive -Uri 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' `
        -Sha256 '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a' -Destination $archive
    $staging = Join-Path $toolchain 'unpack-commandline-tools'
    Expand-VerifiedArchive -Archive $archive -Destination $staging
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $commandlineTools) | Out-Null
    Move-Item -LiteralPath (Join-Path $staging 'cmdline-tools') -Destination $commandlineTools
}

. (Join-Path $PSScriptRoot 'android-env.ps1')
& (Join-Path $env:JAVA_HOME 'bin\java.exe') -version
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel executar o Java instalado.' }

$sdkmanager = Join-Path $commandlineTools 'bin\sdkmanager.bat'
$licenseLog = Join-Path $toolchain 'sdk-licenses.log'
Write-Host 'Aceitando as licencas padrao do SDK, conforme autorizado. Registro em .data/android-toolchain/sdk-licenses.log.'
# Processo separado evita que PowerShell interprete mensagens stderr do Java como falha.
$answers = (1..100 | ForEach-Object { 'y' }) -join "`n"
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $env:ComSpec
$start.Arguments = "/d /s /c `"`"$sdkmanager`" --sdk_root=`"$sdk`" --licenses`""
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
$process.Start() | Out-Null
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
$process.StandardInput.WriteLine($answers)
$process.StandardInput.Close()
$process.WaitForExit()
[IO.File]::WriteAllText($licenseLog, $stdout.Result + $stderr.Result)
if ($process.ExitCode -ne 0) { throw "Falha ao configurar licencas. Consulte $licenseLog" }

Write-Host 'Instalando Android SDK 36, Build Tools 35.0.0 e Platform Tools...'
& $sdkmanager "--sdk_root=$sdk" 'platforms;android-36' 'build-tools;35.0.0' 'platform-tools'
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar os componentes do Android SDK.' }

$metadata = [ordered]@{
    java = 'Eclipse Temurin 21.0.13+9 (bytecode do aplicativo: Java 17)'
    gradle = '8.13'
    gradleSha256 = $gradleChecksum
    sdk = $sdk
    compileSdk = 36
    buildTools = '35.0.0'
}
$metadata | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $toolchain 'installation.json')
Write-Host 'Ambiente Android instalado localmente. Nenhuma variavel global do Windows foi alterada.'
Write-Host 'Proximo comando: npm run android:build'
