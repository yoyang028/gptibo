param([switch]$Dev)
. (Join-Path $PSScriptRoot 'env.ps1')
if (!(Test-Path -LiteralPath $StorefrontExe)) { throw 'Run scripts/local/init.ps1 first.' }
Start-LocalPostgres
Set-RuntimeDatabase
& $StorefrontExe check-runtime
Assert-Exit 'Runtime validation'
$stateFile = Join-Path $LocalRoot 'run/processes.json'
$state = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }

function Start-Component([string]$name, [string]$executable, [string[]]$arguments) {
    if ($state.ContainsKey($name)) {
        $record = $state[$name]
        if (Get-TrackedProcess $record) { return }
    }
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LocalRoot "logs/$name.out.log") -RedirectStandardError (Join-Path $LocalRoot "logs/$name.err.log") -PassThru
    $state[$name] = @{pid=$process.Id; startedAt=$process.StartTime.ToUniversalTime().ToString('o'); executable=$process.Path}
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding utf8
}
Start-Component 'worker' $StorefrontExe @('worker')
Start-Component 'api' $StorefrontExe @('api')
$viteArguments = @(('"' + (Join-Path $ProjectRoot 'node_modules/vite/bin/vite.js') + '"'))
if (!$Dev) {
    if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot 'services/storefront/.preview/index.html'))) { throw 'Build the local frontend with scripts/local/init.ps1 first.' }
    $viteArguments += @('preview', '--host', '127.0.0.1', '--port', '5175', '--strictPort')
}
$viteArguments += @('--config', ('"' + (Join-Path $ProjectRoot 'services/storefront/vite.config.ts') + '"'))
Start-Component 'frontend' $NodeExe $viteArguments
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8093/healthz' -TimeoutSec 3
        $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5175/api/catalog' -TimeoutSec 3
        if ($page.StatusCode -eq 200 -and $health.ready -and $health.worker_ready) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (!$ready) { throw 'Startup readiness failed. Inspect artifacts/local/logs and scripts/local/status.ps1.' }
Write-Output 'Storefront: http://127.0.0.1:5175'
Write-Output 'Admin:      http://127.0.0.1:5175/admin'
Write-Output 'Partner:    http://127.0.0.1:5175/partner'
Write-Output 'Shop:       http://127.0.0.1:5175/s/LOCAL1'
Write-Output 'Login codes: node scripts/local/auth.mjs admin (or partner)'
