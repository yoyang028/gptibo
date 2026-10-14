param([ValidateSet('start','status','stop','build','tunnel','stop-tunnel')][string]$Mode = 'start', [ValidateSet('quic','http2')][string]$TunnelProtocol = 'quic', [ValidateSet('','198.41.192.167:7844','198.41.200.13:7844')][string]$TunnelEdge = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$paymentDirectory = Join-Path $SecretsRoot 'quefa-payment-test'
$paymentExe = Join-Path $LocalRoot 'run/quefa-paytest.exe'
$recordFile = Join-Path $LocalRoot 'run/quefa-paytest-process.json'
$tunnelRecordFile = Join-Path $LocalRoot 'run/quefa-paytest-tunnel-process.json'
New-Item -ItemType Directory -Force -Path $paymentDirectory | Out-Null
$record = if (Test-Path -LiteralPath $recordFile) { Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json } else { $null }
$process = if ($record) { Get-TrackedProcess $record } else { $null }
$tunnelRecord = if (Test-Path -LiteralPath $tunnelRecordFile) { Get-Content -LiteralPath $tunnelRecordFile -Raw | ConvertFrom-Json } else { $null }
$tunnel = if ($tunnelRecord) { Get-TrackedProcess $tunnelRecord } else { $null }
if ($Mode -in @('stop','stop-tunnel')) {
    if ($tunnel) { Stop-Process -Id $tunnel.Id; $tunnel.WaitForExit(5000) | Out-Null }
    if ($Mode -eq 'stop' -and $process) { Stop-Process -Id $process.Id; $process.WaitForExit(5000) | Out-Null }
    Write-Output 'Tracked payment-test tunnel stopped. Existing encrypted test state and credentials were retained.'
    exit 0
}
if ($Mode -eq 'status') {
    [pscustomobject]@{ Running = [bool]$process; Address = 'http://127.0.0.1:8769'; TunnelRunning = [bool]$tunnel; TestStateSaved = Test-Path -LiteralPath (Join-Path $paymentDirectory 'one-cny-state.dpapi'); CallbackConfigured = Test-Path -LiteralPath (Join-Path $paymentDirectory 'callback.json') } | Format-List
    exit 0
}
if ($Mode -eq 'tunnel') {
    if (!$process) { throw 'Start the local payment-test receiver first.' }
    $callbackFile = Join-Path $paymentDirectory 'callback.json'
    if ($tunnel -and (Test-Path -LiteralPath $callbackFile)) { Write-Output 'Tracked payment-test tunnel is already running.'; exit 0 }
    if (!$tunnel -and (Test-Path -LiteralPath $callbackFile)) { throw 'A callback URL was already assigned to this single test. Inspect the existing order and address before replacing its tunnel.' }
    if ($tunnel) {
        if ($tunnelRecord.origin -ne 'http://127.0.0.1:8770') { throw 'The tracked tunnel origin is not the payment-test receiver.' }
        $logPrefix = $tunnelRecord.logPrefix
    } else {
    $cloudflared = Join-Path $LocalRoot 'tools/cloudflared/cloudflared.exe'
    if ((Get-FileHash -LiteralPath $cloudflared -Algorithm SHA256).Hash.ToLowerInvariant() -ne '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c') { throw 'Cloudflared official checksum mismatch.' }
    $configFile = Join-Path $LocalRoot 'run/quefa-paytest-cloudflared.yml'
    '{}' | Set-Content -LiteralPath $configFile -Encoding utf8
    $logPrefix = Join-Path $LocalRoot ('logs/quefa-paytest-tunnel-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
    Remove-Item Env:TUNNEL_TOKEN,Env:TUNNEL_TOKEN_FILE -ErrorAction SilentlyContinue
    $arguments = @('tunnel','--config',('"'+$configFile+'"'),'--origincert',('"'+(Join-Path $paymentDirectory 'unused-origin-cert.pem')+'"'),'--no-autoupdate','--protocol',$TunnelProtocol,'--metrics','127.0.0.1:0','--logfile',('"'+$logPrefix+'.log"'),'--url','http://127.0.0.1:8770')
    if ($TunnelEdge) { $arguments += @('--edge',$TunnelEdge) }
    $tunnel = Start-Process -FilePath $cloudflared -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput ($logPrefix+'.out.log') -RedirectStandardError ($logPrefix+'.err.log') -PassThru
    [pscustomobject]@{ pid=$tunnel.Id; executable=$cloudflared; startedAt=$tunnel.StartTime.ToUniversalTime().ToString('o'); origin='http://127.0.0.1:8770'; logPrefix=$logPrefix } | ConvertTo-Json | Set-Content -LiteralPath $tunnelRecordFile -Encoding utf8
    }
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        $tunnel.Refresh()
        if ($tunnel.HasExited) { throw 'Payment-test tunnel exited. Inspect its D-drive logs.' }
        $log = if (Test-Path -LiteralPath ($logPrefix+'.err.log')) { [string](Get-Content -LiteralPath ($logPrefix+'.err.log') -Raw) } else { '' }
        $address = [regex]::Match($log,'https://[a-z0-9-]+\.trycloudflare\.com').Value
        if ($address -and $log -match 'Registered tunnel connection') {
            [pscustomobject]@{ notify_url=($address+'/api/recharge/webhook') } | ConvertTo-Json | Set-Content -LiteralPath $callbackFile -Encoding utf8
            Write-Output ('Payment-test callback: '+$address+'/api/recharge/webhook')
            exit 0
        }
        Start-Sleep -Seconds 1
    }
    throw 'Payment-test tunnel readiness timed out. Inspect the tracked process instead of opening another tunnel.'
}
if ($Mode -eq 'build' -and $process) { throw 'Stop the isolated payment-test process before rebuilding.' }
if ($Mode -eq 'build' -or !(Test-Path -LiteralPath $paymentExe)) {
    Push-Location (Join-Path $ProjectRoot 'services/storefront')
    try { & $GoExe build -trimpath -o $paymentExe ./cmd/quefa-paytest; Assert-Exit 'Build one-CNY payment test' } finally { Pop-Location }
}
if ($Mode -eq 'build') { exit 0 }
$authorizationFile = Join-Path $paymentDirectory 'authorization.json'
if (!(Test-Path -LiteralPath $authorizationFile)) { throw 'Explicit user authorization for one real CNY payment test is required.' }
$authorization = Get-Content -LiteralPath $authorizationFile -Raw | ConvertFrom-Json
if ($authorization.authorized -ne $true -or $authorization.amount_cents -ne 100 -or $authorization.max_orders -ne 1) { throw 'The saved authorization must cover exactly one one-CNY test.' }
if (!$process) {
    $credentialsDirectory = Join-Path $SecretsRoot 'quefa-readonly'
    $process = Start-Process -FilePath $paymentExe -ArgumentList @('-authorized-one-cny','-credentials-directory',('"'+$credentialsDirectory+'"'),'-directory',('"'+$paymentDirectory+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LocalRoot 'logs/quefa-paytest.out.log') -RedirectStandardError (Join-Path $LocalRoot 'logs/quefa-paytest.err.log') -PassThru
    [pscustomobject]@{ pid=$process.Id; executable=$paymentExe; startedAt=$process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding utf8
}
for ($attempt=0; $attempt -lt 25; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Payment-test process exited. Inspect artifacts/local/logs/quefa-paytest.err.log.' }
    try { if ((Invoke-WebRequest -Uri 'http://127.0.0.1:8769/' -TimeoutSec 2).StatusCode -eq 200) { Write-Output 'One-CNY payment test ready: http://127.0.0.1:8769'; exit 0 } } catch { }
    Start-Sleep -Milliseconds 300
}
throw 'Local payment-test readiness timed out.'
