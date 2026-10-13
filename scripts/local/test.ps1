. (Join-Path $PSScriptRoot 'env.ps1')
Start-LocalPostgres
$ownerPassword = (Get-Content -LiteralPath (Join-Path $SecretsRoot 'owner-password') -Raw).Trim()
$env:STOREFRONT_TEST_DATABASE_URL = "postgres://storefront_owner:$ownerPassword@127.0.0.1:55432/gptibo_local_test?sslmode=disable"
# Unit tests assert safe defaults. Do not inherit the development administrator.
foreach ($key in @('LOCAL_MAIL_DIR','AUTH_SECRET','AUTH_SECRET_FILE','ADMIN_USERNAME','ADMIN_EMAIL','ADMIN_TOTP_SECRET','ADMIN_TOTP_SECRET_FILE','DB_PASSWORD_FILE','APP_DB_PASSWORD_FILE','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_SSLMODE','PUBLIC_ORIGIN','LISTEN_ADDR','WORKER_ID','ORDER_TESTING_ENABLED','MAIL_FROM')) {
    Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
}
Push-Location $ProjectRoot
try {
    & $NodeExe $NpmCli run lint
    Assert-Exit 'Frontend lint'
    & $NodeExe $NpmCli test
    Assert-Exit 'Frontend and Worker tests'
    & $NodeExe $NpmCli run build
    Assert-Exit 'Frontend, Worker and email build'
    & $NodeExe $NpmCli run security:scan
    Assert-Exit 'Tracked public source scan'
    Push-Location (Join-Path $ProjectRoot 'services/storefront')
    try {
        & $GoExe vet ./...
        Assert-Exit 'Go vet'
        & $GoExe test -count=1 -timeout 600s ./...
        Assert-Exit 'Go unit and real PostgreSQL integration tests'
    } finally { Pop-Location }
} finally {
    $env:STOREFRONT_TEST_DATABASE_URL = ''
    Pop-Location
}
