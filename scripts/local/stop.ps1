. (Join-Path $PSScriptRoot 'env.ps1')
$stateFile = Join-Path $LocalRoot 'run/processes.json'
if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json -AsHashtable
    foreach ($name in @('frontend', 'api', 'worker')) {
        if (!$state.ContainsKey($name)) { continue }
        $record = $state[$name]
        $process = Get-TrackedProcess $record
        if ($process) {
            Stop-Process -Id $process.Id
            Write-Output "Stopped $name."
        }
    }
    @{} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
}
if (!(Test-Path -LiteralPath (Join-Path $PostgresData 'PG_VERSION'))) { return }
# The resolved data directory belongs to this project; never stop a system instance.
if (!(Resolve-Path -LiteralPath $PostgresData).Path.StartsWith($ProjectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected database data path.' }
& (Join-Path $PostgresBin 'pg_ctl.exe') status -D $PostgresData *> $null
if ($LASTEXITCODE -eq 0) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') stop -D $PostgresData -m fast -w
    Assert-Exit 'Local PostgreSQL stop'
}
