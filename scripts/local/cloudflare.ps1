param([ValidateSet('start','stop','status','test','login')][string]$Mode = 'start')
. (Join-Path $PSScriptRoot 'env.ps1')
$recordFile = Join-Path $LocalRoot 'run/cloudflare-processes.json'
$private = Join-Path $SecretsRoot 'quefa-cloudflare-mock'
$mockExe = Join-Path $LocalRoot 'run/quefa-cloudflare-mock.exe'
$state = if (Test-Path -LiteralPath $recordFile) { Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
if ($Mode -eq 'login') { & $NodeExe (Join-Path $ProjectRoot 'scripts/cloudflare/login.mjs'); return }

if ($Mode -eq 'test') {
    & $NodeExe (Join-Path $ProjectRoot 'scripts/cloudflare/acceptance.mjs')
    Assert-Exit 'Cloudflare browser acceptance'
    return
}
if ($Mode -eq 'status') {
    foreach ($address in @('http://127.0.0.1:8772/state','http://127.0.0.1:8774/state')) {
        $response = Invoke-WebRequest -Uri $address -TimeoutSec 5
        Write-Output "$address : $($response.StatusCode)"
    }
    return
}
if ($Mode -eq 'stop') {
    if ($state.ContainsKey('cloudflare-runtime') -and (Get-TrackedProcess $state['cloudflare-runtime'])) {
        try {
            $headers = @{Origin='http://127.0.0.1:8774'; 'X-Local-Control'=(Get-Content -LiteralPath (Join-Path $private 'control-token') -Raw).Trim()}
            Invoke-WebRequest -Uri 'http://127.0.0.1:8774/shutdown' -Method Post -Headers $headers -TimeoutSec 15 | Out-Null
        } catch { Write-Warning 'Graceful shutdown unavailable; stopping only the tracked local runtime tree.' }
        $process = Get-TrackedProcess $state['cloudflare-runtime']
        if ($process -and -not $process.WaitForExit(15000)) { $process.Kill($true) }
    }
    if ($state.ContainsKey('cloudflare-mock')) {
        $process = Get-TrackedProcess $state['cloudflare-mock']
        if ($process) { Stop-Process -Id $process.Id; $process.WaitForExit(10000) | Out-Null }
    }
    @{} | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding utf8
    Write-Output 'Independent Cloudflare runtime stopped; D1 state and evidence retained.'
    return
}
foreach ($name in @('cloudflare-runtime','cloudflare-mock')) {
    if ($state.ContainsKey($name) -and (Get-TrackedProcess $state[$name])) { throw 'Runtime is already running. Use status or stop before rebuilding.' }
}
& $NodeExe $NpmCli run build *> (Join-Path $LocalRoot 'logs/cloudflare-production-build.log')
Assert-Exit 'Production frontend build'
& $GoExe -C (Join-Path $ProjectRoot 'services/storefront') build -trimpath -o $mockExe ./cmd/quefa-mock
Assert-Exit 'Independent supplier fixture build'
& $mockExe init $private
Assert-Exit 'Independent supplier initialization'
function Start-CloudflareComponent([string]$name,[string]$executable,[string[]]$arguments) {
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LocalRoot "logs/$name.out.log") -RedirectStandardError (Join-Path $LocalRoot "logs/$name.err.log") -PassThru
    $state[$name] = @{pid=$process.Id; startedAt=$process.StartTime.ToUniversalTime().ToString('o'); executable=$process.Path}
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordFile -Encoding utf8
}
Start-CloudflareComponent 'cloudflare-mock' $mockExe @('serve-cloudflare',('"'+$private+'"'))
Start-CloudflareComponent 'cloudflare-runtime' $NodeExe @(('"'+(Join-Path $ProjectRoot 'scripts/cloudflare/local-runtime.mjs')+'"'))
for ($attempt=0; $attempt -lt 60; $attempt++) {
    $process = Get-TrackedProcess $state['cloudflare-runtime']
    if (!$process) { throw 'Cloudflare runtime exited; inspect artifacts/local/logs/cloudflare-runtime.err.log.' }
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8774/state' -TimeoutSec 2
        if ($response.StatusCode -eq 200) { Write-Output 'Cloudflare local store: https://127.0.0.1:8771 (local test certificate); simulator: http://127.0.0.1:8772'; return }
    } catch { Start-Sleep -Seconds 1 }
}
throw 'Cloudflare runtime readiness timed out; inspect artifacts/local/logs.'
