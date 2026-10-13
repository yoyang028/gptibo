$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ([IO.Path]::GetPathRoot($ProjectRoot) -ne 'D:\') { throw 'Local runtime and data must stay on D:.' }
$LocalRoot = Join-Path $ProjectRoot 'artifacts/local'
$SecretsRoot = Join-Path $LocalRoot '.secrets'
$PostgresBin = Join-Path $LocalRoot 'tools/pgsql/bin'
$GoExe = Join-Path $LocalRoot 'tools/go/bin/go.exe'
$StorefrontExe = Join-Path $LocalRoot 'run/storefront.exe'
$PostgresData = Join-Path $LocalRoot 'postgres-data'
$NpmCli = Join-Path $LocalRoot 'tools/npm/package/bin/npm-cli.js'
$preferredNode = 'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$NodeExe = if (Test-Path -LiteralPath $preferredNode) { $preferredNode } else { (Get-Command node.exe).Source }
$env:PATH = (Join-Path $LocalRoot 'tools/bin') + ';' + (Split-Path $NodeExe) + ';' + $PostgresBin + ';' + (Split-Path $GoExe) + ';' + $env:PATH
# These variables affect this process and its children only, never Windows settings.
$env:TEMP = Join-Path $LocalRoot 'tmp'
$env:TMP = $env:TEMP
$env:GOCACHE = Join-Path $LocalRoot 'cache/go-build'
$env:GOMODCACHE = Join-Path $LocalRoot 'cache/go-mod'
$env:GOPATH = Join-Path $LocalRoot 'cache/gopath'
$env:GOTOOLCHAIN = 'local'
$env:NPM_CONFIG_CACHE = 'D:\ChatGPT\Caches\npm'
foreach ($directory in @($SecretsRoot, $env:TEMP, $env:GOCACHE, $env:GOMODCACHE, (Join-Path $LocalRoot 'logs'), (Join-Path $LocalRoot 'run'), (Join-Path $LocalRoot 'mailbox'))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
$env:DATABASE_URL = ''
$env:DATABASE_URL_FILE = ''
$env:DB_PASSWORD = ''
$env:APP_DB_PASSWORD = ''
$env:AUTH_SECRET = ''
$env:ADMIN_TOTP_SECRET = ''
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '55432'
$env:DB_NAME = 'gptibo_local'
$env:DB_USER = 'storefront_app'
$env:DB_SSLMODE = 'disable'
$env:DB_PASSWORD_FILE = Join-Path $SecretsRoot 'app-password'
$env:APP_DB_PASSWORD_FILE = $env:DB_PASSWORD_FILE
$env:AUTH_SECRET_FILE = Join-Path $SecretsRoot 'auth-secret'
$env:ADMIN_TOTP_SECRET_FILE = Join-Path $SecretsRoot 'admin-totp'
$env:ADMIN_USERNAME = 'dev-admin'
$env:ADMIN_EMAIL = 'admin@example.invalid'
$env:LISTEN_ADDR = '127.0.0.1:8093'
$env:PUBLIC_ORIGIN = 'http://127.0.0.1:8093'
$env:WORKER_ID = 'storefront-worker'
$env:MAIL_FROM = 'GPTibo Local <noreply@example.invalid>'
$env:LOCAL_MAIL_DIR = Join-Path $LocalRoot 'mailbox'
$env:ORDER_TESTING_ENABLED = 'true'
foreach ($flag in @('MAIL_ENABLED','PAYMENT_TEST_ENABLED','PAYMENT_CHECKOUT_ENABLED','ALIPAY_ENABLED','GATEWAYA_ENABLED','GATEWAYB_ENABLED','RECHARGE_ENABLED','ACCOUNT_SUPPLIER_ENABLED','DELIVERY_SUPPLIER_ENABLED','EMAIL_PRODUCTS_ENABLED','XGIFT_ENABLED','XGIFT_PLATFORM_ENABLED','TELEGRAM_ENABLED','FEISHU_PAYOUT_ENABLED','TURNSTILE_ENABLED','AUTH_TURNSTILE_ENABLED','SECURITY_AUDIT_ENABLED','TRAFFIC_PROTECTION_ENABLED','MIGRATION_REHEARSAL','LEGACY_BUYER_COOKIE_ENABLED')) {
    [Environment]::SetEnvironmentVariable($flag, 'false', 'Process')
}
foreach ($name in @('TRUSTED_PROXY_CIDRS','ADMIN_ACCESS_ISSUER','ADMIN_ACCESS_AUDIENCE')) {
    [Environment]::SetEnvironmentVariable($name, '', 'Process')
}

function Assert-Exit([string]$operation) {
    if ($LASTEXITCODE -ne 0) { throw "$operation failed (exit $LASTEXITCODE). Check artifacts/local/logs." }
}

function Set-OwnerDatabase {
    $env:DB_USER = 'storefront_owner'
    $env:DB_PASSWORD_FILE = Join-Path $SecretsRoot 'owner-password'
    $env:PGPASSWORD = (Get-Content -LiteralPath $env:DB_PASSWORD_FILE -Raw).Trim()
}

function Set-RuntimeDatabase {
    $env:DB_USER = 'storefront_app'
    $env:DB_PASSWORD_FILE = Join-Path $SecretsRoot 'app-password'
    $env:PGPASSWORD = ''
}

function Start-LocalPostgres {
    & (Join-Path $PostgresBin 'pg_ctl.exe') status -D $PostgresData *> $null
    if ($LASTEXITCODE -eq 0) { return }
    # Do not wait on a captured native stdout pipe inherited by the persistent
    # Windows server. Start the launcher separately and probe actual readiness.
    $launcher = Start-Process -FilePath (Join-Path $PostgresBin 'pg_ctl.exe') -ArgumentList @('start', '-D', ('"' + $PostgresData + '"'), '-l', ('"' + (Join-Path $LocalRoot 'logs/postgres.log') + '"'), '-w') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LocalRoot 'logs/postgres-start.out.log') -RedirectStandardError (Join-Path $LocalRoot 'logs/postgres-start.err.log') -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($launcher.HasExited -and $launcher.ExitCode -ne 0) { throw 'PostgreSQL launcher failed. Check artifacts/local/logs.' }
        & (Join-Path $PostgresBin 'pg_isready.exe') -h 127.0.0.1 -p 55432 -U storefront_owner -d postgres *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw 'Local PostgreSQL readiness timed out.'
}

function Get-TrackedProcess($record) {
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($process -and $process.Path -eq $record.executable -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$record.startedAt).ToUniversalTime().Ticks) {
        return $process
    }
    return $null
}
