. (Join-Path $PSScriptRoot 'env.ps1')
foreach ($file in @($GoExe, $NodeExe, $NpmCli, (Join-Path $PostgresBin 'initdb.exe'))) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing local tool: $file. See docs/LOCAL_SETUP.md." }
}
Push-Location $ProjectRoot
try {
    & $NodeExe (Join-Path $PSScriptRoot 'auth.mjs') init
    Assert-Exit 'Independent local secrets'
    if (!(Test-Path -LiteralPath (Join-Path $PostgresData 'PG_VERSION'))) {
        & (Join-Path $PostgresBin 'initdb.exe') -D $PostgresData -U storefront_owner --pwfile (Join-Path $SecretsRoot 'owner-password') --auth=scram-sha-256 --encoding=UTF8 --locale=C
        Assert-Exit 'PostgreSQL cluster initialization'
        Add-Content -LiteralPath (Join-Path $PostgresData 'postgresql.conf') -Value "`nlisten_addresses = '127.0.0.1'`nport = 55432`nmax_connections = 100`ntimezone = 'Asia/Shanghai'`nlog_timezone = 'Asia/Shanghai'"
    }
    Start-LocalPostgres
    Set-OwnerDatabase
    foreach ($database in @('gptibo_local', 'gptibo_local_test')) {
        $exists = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p 55432 -U storefront_owner -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='$database'"
        Assert-Exit 'Check local database'
        if ($exists -ne '1') {
            & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U storefront_owner --template=template0 --encoding=UTF8 $database
            Assert-Exit 'Create dedicated local database'
        }
    }
    Push-Location (Join-Path $ProjectRoot 'services/storefront')
    try {
        & $GoExe build -trimpath -o $StorefrontExe ./cmd/storefront
        Assert-Exit 'Go backend build'
    } finally { Pop-Location }
    & $StorefrontExe migrate
    Assert-Exit 'Database migration'
    & $StorefrontExe grant-runtime
    Assert-Exit 'Restricted runtime grants'
    & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p 55432 -U storefront_owner -d gptibo_local -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot 'seed.sql')
    Assert-Exit 'Synthetic local catalogue'
    Set-RuntimeDatabase
    & $StorefrontExe check-runtime
    Assert-Exit 'Runtime configuration and privileges'
    & $NodeExe $NpmCli run build
    Assert-Exit 'Frontend, Worker and email build'
    & $NodeExe (Join-Path $ProjectRoot 'node_modules/vite/bin/vite.js') build --config (Join-Path $ProjectRoot 'services/storefront/vite.config.ts')
    Assert-Exit 'Local frontend preview build'
    Write-Output 'Local cluster, migrations, synthetic catalogue and restricted runtime are ready.'
} finally {
    $env:PGPASSWORD = ''
    Pop-Location
}
