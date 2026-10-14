param([ValidateSet('init','start','stop','status','login','test')][string]$Mode = 'start')
. (Join-Path $PSScriptRoot 'env.ps1')
$env:DB_NAME = 'gptibo_quefa_local'
$env:LISTEN_ADDR = '127.0.0.1:8094'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:8094'
$env:WORKER_ID = 'quefa-mock-worker'
$env:LOCAL_QUEFA_MOCK = 'true'
$env:ORDER_TESTING_ENABLED = 'false'
$env:RECHARGE_ENABLED = 'true'
$env:RECHARGE_CHECKOUT_ENABLED = 'true'
$env:RECHARGE_API_BASE = 'https://127.0.0.1:8766/v1'
$env:RECHARGE_PARTNER_ID = 'pt_local_mock'
$env:RECHARGE_KEY_ID = 'key_local_mock'
$env:RECHARGE_CLIENT_SECRET_FILE = ''
$env:RECHARGE_CLIENT_SECRET = 'local_mock_signing_not_a_real_credential'
$env:RECHARGE_WEBHOOK_SECRET_FILE = ''
$env:RECHARGE_WEBHOOK_SECRET = 'local_mock_webhook_not_a_real_credential'
$env:RECHARGE_PRODUCT_MAP = '{"plus":"chatgpt_plus_cdk_1m"}'
$env:RECHARGE_COLLECTION_MODE = 'platform_collect'
$env:RECHARGE_NOTIFY_URL = 'http://127.0.0.1:8094/api/recharge/webhook'
$env:SESSION_PRECHECK_ENABLED = 'false'
$mockDirectory = Join-Path $SecretsRoot 'quefa-mock'
$env:RECHARGE_LOCAL_CA_FILE = Join-Path $mockDirectory 'cert.pem'
$backend = Join-Path $LocalRoot 'run/storefront-quefa.exe'
$mockExe = Join-Path $LocalRoot 'run/quefa-mock.exe'
$stateFile = Join-Path $LocalRoot 'run/quefa-processes.json'
$state = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
if ($Mode -eq 'login') { & $NodeExe (Join-Path $PSScriptRoot 'auth.mjs') admin --watch --quefa; return }
if ($Mode -eq 'test') { & $NodeExe (Join-Path $PSScriptRoot 'quefa-browser-test.mjs'); Assert-Exit 'Quefa browser acceptance'; return }

function Stop-QuefaComponents {
    foreach ($name in @('quefa-frontend','quefa-api','quefa-worker','quefa-mock')) {
        if ($state.ContainsKey($name)) {
            $process = Get-TrackedProcess $state[$name]
            if ($process) { Stop-Process -Id $process.Id; $process.WaitForExit(10000) | Out-Null }
        }
    }
    $state.Clear()
    $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
}
function Start-QuefaComponent([string]$name,[string]$executable,[string[]]$arguments) {
    if ($state.ContainsKey($name) -and (Get-TrackedProcess $state[$name])) { return }
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LocalRoot "logs/$name.out.log") -RedirectStandardError (Join-Path $LocalRoot "logs/$name.err.log") -PassThru
    $state[$name] = @{pid=$process.Id; startedAt=$process.StartTime.ToUniversalTime().ToString('o'); executable=$process.Path}
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding utf8
}
if ($Mode -eq 'stop') { Stop-QuefaComponents; Write-Output 'Quefa local components stopped; shared PostgreSQL retained.'; return }
if ($Mode -eq 'status') {
    foreach ($url in @('http://127.0.0.1:8765/state','http://127.0.0.1:8094/healthz','http://127.0.0.1:5176/api/catalog')) {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 5
        Write-Output "$url : $($response.StatusCode)"
        if ($url.EndsWith('/healthz')) { Write-Output $response.Content }
    }
    return
}
Start-LocalPostgres
if ($Mode -eq 'init' -or !(Test-Path -LiteralPath $backend) -or !(Test-Path -LiteralPath $mockExe)) {
    Stop-QuefaComponents
    Set-OwnerDatabase
    $exists = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p 55432 -U storefront_owner -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='gptibo_quefa_local'"
    Assert-Exit 'Check isolated Quefa database'
    if ($exists -ne '1') {
        & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U storefront_owner --template=template0 --encoding=UTF8 gptibo_quefa_local
        Assert-Exit 'Create isolated Quefa database'
    }
    Push-Location (Join-Path $ProjectRoot 'services/storefront')
    try {
        & $GoExe build -trimpath -o $backend ./cmd/storefront
        Assert-Exit 'Build Quefa backend'
        & $GoExe build -trimpath -o $mockExe ./cmd/quefa-mock
        Assert-Exit 'Build loopback Quefa simulator'
    } finally { Pop-Location }
    & $mockExe init $mockDirectory
    Assert-Exit 'Initialize private local mock TLS certificate'
    & $backend migrate
    Assert-Exit 'Migrate isolated Quefa database'
    & $backend grant-runtime
    Assert-Exit 'Grant restricted runtime on isolated database'
    & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p 55432 -U storefront_owner -d gptibo_quefa_local -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot 'quefa-seed.sql')
    Assert-Exit 'Seed synthetic Plus catalogue'
    Push-Location $ProjectRoot
    try {
        & $NodeExe $NpmCli run build
        Assert-Exit 'Build and type-check frontend and Worker'
        & $NodeExe (Join-Path $ProjectRoot 'node_modules/vite/bin/vite.js') build --config (Join-Path $ProjectRoot 'services/storefront/vite.config.ts')
        Assert-Exit 'Build isolated Quefa preview'
    } finally { Pop-Location }
    if ($Mode -eq 'init') { Write-Output 'Isolated Quefa environment initialized.'; return }
}
Set-RuntimeDatabase
& $backend check-runtime
Assert-Exit 'Quefa runtime privileges and configuration'
Start-QuefaComponent 'quefa-mock' $mockExe @('serve', ('"' + $mockDirectory + '"'))
Start-QuefaComponent 'quefa-worker' $backend @('worker')
Start-QuefaComponent 'quefa-api' $backend @('api')
Start-QuefaComponent 'quefa-frontend' $NodeExe @(('"' + (Join-Path $ProjectRoot 'node_modules/vite/bin/vite.js') + '"'),'preview','--host','127.0.0.1','--port','5176','--strictPort','--config',('"' + (Join-Path $ProjectRoot 'services/storefront/vite.config.ts') + '"'))
$ready = $false
for ($attempt=0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8094/healthz' -TimeoutSec 3
        $catalogue = Invoke-WebRequest 'http://127.0.0.1:5176/api/catalog' -TimeoutSec 3
        $mockState = Invoke-RestMethod 'http://127.0.0.1:8765/state' -TimeoutSec 3
        if ($health.ready -and $health.worker_ready -and $catalogue.StatusCode -eq 200 -and $mockState.localMock) { $ready=$true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (!$ready) { throw 'Quefa local readiness failed. Check artifacts/local/logs/quefa-*.' }
Write-Output 'Quefa mock storefront: http://127.0.0.1:5176'
Write-Output 'Admin:                 http://127.0.0.1:5176/admin'
Write-Output 'Simulator controls:    http://127.0.0.1:8765'
Write-Output 'Login helper:          local-quefa.cmd login'
