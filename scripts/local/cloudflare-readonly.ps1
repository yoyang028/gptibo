. (Join-Path $PSScriptRoot 'env.ps1')
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$cipher = [IO.File]::ReadAllBytes((Join-Path $SecretsRoot 'quefa-readonly/credentials.dpapi'))
$plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    $saved = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
    $env:RECHARGE_API_BASE = $saved.api_base
    $env:RECHARGE_PARTNER_ID = $saved.partner_id
    $env:RECHARGE_KEY_ID = $saved.key_id
    $env:RECHARGE_CLIENT_SECRET = $saved.client_secret
    & $NodeExe (Join-Path $ProjectRoot 'scripts/cloudflare/live-check.mjs')
    Assert-Exit 'Actual Worker read-only supplier check'
} finally {
    [Array]::Clear($plain, 0, $plain.Length)
    foreach ($name in @('RECHARGE_API_BASE','RECHARGE_PARTNER_ID','RECHARGE_KEY_ID','RECHARGE_CLIENT_SECRET')) { [Environment]::SetEnvironmentVariable($name, '', 'Process') }
    $saved = $null
}
