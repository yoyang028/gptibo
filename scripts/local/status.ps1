. (Join-Path $PSScriptRoot 'env.ps1')
foreach ($url in @('http://127.0.0.1:8093/healthz', 'http://127.0.0.1:5175/api/catalog', 'http://127.0.0.1:5175/api/admin/session', 'http://127.0.0.1:5175/api/partner/auth/session')) {
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 5
        Write-Output "$url : $($response.StatusCode)"
        if ($url.EndsWith('/healthz')) { Write-Output $response.Content }
    } catch { Write-Output "$url : unavailable" }
}
if (Test-Path -LiteralPath (Join-Path $PostgresData 'PG_VERSION')) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') status -D $PostgresData
}
