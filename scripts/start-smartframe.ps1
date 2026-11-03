param(
    [string]$Serial = '0c000c75b144c762314',
    [switch]$Verificar
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:3000'
$server = $null
$usb = $null
$mutex = $null
$ownsMutex = $false
$exitCode = 0

function Test-SmartFrameServer {
    try {
        # Use IPv4 explicitly: Windows PowerShell may wait on ::1 for localhost.
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
        return ($health.status -eq 'ok' -and $health.service -eq 'smartframe')
    } catch {
        return $false
    }
}

Push-Location $projectRoot
try {
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    if (-not (Test-Path '.env')) {
        throw 'Arquivo .env nao encontrado. A configuracao inicial do projeto precisa ser concluida.'
    }
    if (-not (Test-Path 'node_modules/next/dist/bin/next')) {
        throw 'Dependencias nao encontradas. Execute npm ci na pasta do projeto antes de usar o iniciador.'
    }
    if (-not ($Serial -match '^[A-Za-z0-9._:-]{1,128}$')) {
        throw 'Identificador do tablet invalido.'
    }

    if ($Verificar) {
        Write-Host 'Iniciador pronto. Node.js e dependencias encontrados.'
        if (Test-SmartFrameServer) {
            Write-Host "Servidor SmartFrame ja esta ligado: $url"
        } else {
            Write-Host 'Servidor sera iniciado ao abrir Iniciar SmartFrame.cmd.'
        }
        if (-not (Test-Path 'apps/web/.next/BUILD_ID')) {
            Write-Host 'A primeira abertura tambem preparara o build automaticamente.'
        }
    } else {
        # The OS releases this lock if the console closes or the process is terminated.
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))
            $suffix = ([System.BitConverter]::ToString($hash)).Replace('-', '').Substring(0, 16)
        } finally {
            $hasher.Dispose()
        }
        $mutex = New-Object System.Threading.Mutex($false, "Local\SmartFrame-$suffix")
        try { $ownsMutex = $mutex.WaitOne(0) }
        catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) {
            throw 'O iniciador ja esta aberto. Use a janela SmartFrame que ja esta em execucao.'
        }

        Write-Host ''
        Write-Host 'SMARTFRAME' -ForegroundColor Cyan
        Write-Host 'Mantenha esta janela aberta e o tablet conectado por USB.'
        Write-Host ''

        if (Test-SmartFrameServer) {
            Write-Host 'O servidor ja esta ligado; vou utilizar o existente.'
        } else {
            $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
            if ($listener) {
                throw 'A porta 3000 esta ocupada ou o servidor nao respondeu. Nenhum processo existente foi encerrado.'
            }
            if (-not (Test-Path 'apps/web/.next/BUILD_ID')) {
                Write-Host 'Preparando o sistema pela primeira vez. Aguarde...'
                & npm.cmd run build
                if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o sistema. Confira as mensagens acima.' }
            }
            $server = Start-Process -FilePath $node -ArgumentList @(
                'node_modules/next/dist/bin/next', 'start', 'apps/web',
                '--hostname', '127.0.0.1', '--port', '3000'
            ) -WorkingDirectory $projectRoot -NoNewWindow -PassThru
            $deadline = (Get-Date).AddSeconds(30)
            $ready = $false
            while ((Get-Date) -lt $deadline -and -not $server.HasExited) {
                if (Test-SmartFrameServer) { $ready = $true; break }
                Start-Sleep -Milliseconds 500
            }
            if (-not $ready) { throw 'O servidor nao iniciou. Confira as mensagens acima.' }
        }

        $usb = Start-Process -FilePath $node -ArgumentList @(
            'scripts/tablet-usb.mjs', '--serial', $Serial, '--port', '3000'
        ) -WorkingDirectory $projectRoot -NoNewWindow -PassThru

        Write-Host ''
        Write-Host "Servidor ligado: $url" -ForegroundColor Green
        Write-Host 'A conexao USB sera preparada e restaurada automaticamente quando o tablet responder.'
        Write-Host 'Se o tablet estiver desconectado, conecte o cabo e autorize a depuracao USB.'
        Write-Host 'Para encerrar este iniciador, pressione Ctrl+C.'
        Write-Host ''
        while (-not $usb.HasExited -and ($null -eq $server -or -not $server.HasExited)) {
            Start-Sleep -Seconds 2
        }
        if ($usb.HasExited) { throw 'O monitor USB encerrou. Confira as mensagens acima.' }
        throw 'O servidor encerrou. Confira as mensagens acima.'
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    $exitCode = 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $exitCode = 1
} finally {
    # Only stop child processes created by this launcher, never an existing server.
    foreach ($child in @($usb, $server)) {
        if ($null -ne $child -and -not $child.HasExited) {
            Stop-Process -Id $child.Id -ErrorAction SilentlyContinue
        }
    }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
    Pop-Location
}
exit $exitCode
