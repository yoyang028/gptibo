param([ValidateSet('start','status','stop','build')][string]$Mode = 'start')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$checkDirectory = Join-Path $SecretsRoot 'quefa-readonly'
$checkExe = Join-Path $LocalRoot 'run/quefa-check.exe'
$recordFile = Join-Path $LocalRoot 'run/quefa-check-process.json'
New-Item -ItemType Directory -Force -Path $checkDirectory | Out-Null
$record = if (Test-Path -LiteralPath $recordFile) { Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json } else { $null }
$process = if ($record) { Get-TrackedProcess $record } else { $null }
if ($Mode -eq 'stop') {
    if ($process) { Stop-Process -Id $process.Id; $process.WaitForExit(5000) | Out-Null }
    Write-Output 'Read-only checker stopped. Encrypted credentials and existing storefront services were retained.'
    exit 0
}
if ($Mode -eq 'status') {
    [pscustomobject]@{ Running = [bool]$process; Address = 'http://127.0.0.1:8767'; EncryptedCredentialsSaved = Test-Path -LiteralPath (Join-Path $checkDirectory 'credentials.dpapi'); ResultSaved = Test-Path -LiteralPath (Join-Path $checkDirectory 'result.json') } | Format-List
    exit 0
}
if ($Mode -eq 'build' -and $process) { throw 'Stop the read-only checker before rebuilding.' }
if ($Mode -eq 'build' -or !(Test-Path -LiteralPath $checkExe)) {
    Push-Location (Join-Path $ProjectRoot 'services/storefront')
    try { & $GoExe build -trimpath -o $checkExe ./cmd/quefa-check; Assert-Exit 'Build read-only checker' } finally { Pop-Location }
}
if ($Mode -eq 'build') { exit 0 }
if (!(Test-Path -LiteralPath (Join-Path $checkDirectory 'endpoint.json'))) {
    throw 'Set api_base in artifacts/local/.secrets/quefa-readonly/endpoint.json first. See docs/QUEFA_LOCAL.md.'
}
if (!$process) {
    $process = Start-Process -FilePath $checkExe -ArgumentList @('-directory', ('"' + $checkDirectory + '"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LocalRoot 'logs/quefa-check.out.log') -RedirectStandardError (Join-Path $LocalRoot 'logs/quefa-check.err.log') -PassThru
    [pscustomobject]@{ pid = $process.Id; executable = $checkExe; startedAt = $process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding utf8
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw 'Read-only checker exited. Check artifacts/local/logs/quefa-check.err.log.' }
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8767/' -TimeoutSec 2
        if ($response.StatusCode -eq 200) { Write-Output 'Read-only check ready: http://127.0.0.1:8767'; exit 0 }
    } catch { }
    Start-Sleep -Milliseconds 300
}
throw 'Read-only checker readiness timed out.'
