# Local interactive configuration only. Never sends mail or uploads secrets.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ([IO.Path]::GetPathRoot($project) -ne 'D:\') { throw 'Production configuration must stay on D:.' }
$env:TEMP = Join-Path $project 'artifacts/local/tmp'
$env:TMP = $env:TEMP
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    $helper = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"')) -WindowStyle Hidden -Wait -PassThru
    exit $helper.ExitCode
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$profilePath = Join-Path $project 'artifacts/cloudflare/.secrets/production.dpapi'
$statusPath = Join-Path $project 'artifacts/cloudflare/prepared/production-local-status.json'
if (!(Test-Path -LiteralPath $profilePath)) { throw 'Initialize the encrypted production profile first.' }
$clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($profilePath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try { $script:mailProfile = [Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json -AsHashtable } finally { [Array]::Clear($clear,0,$clear.Length) }
[Windows.Forms.Application]::EnableVisualStyles()
$form = [Windows.Forms.Form]::new()
$form.Text = 'GPTibo · 本机保存发信配置'
$form.ClientSize = [Drawing.Size]::new(650,365)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = [Drawing.Font]::new('Microsoft YaHei UI',10)
function Add-Label([string]$text,[int]$top,[int]$height=28) {
    $label = [Windows.Forms.Label]::new()
    $label.Text = $text; $label.Location = [Drawing.Point]::new(22,$top); $label.Size = [Drawing.Size]::new(606,$height)
    $form.Controls.Add($label)
    return $label
}
$null = Add-Label 'Resend 密钥只保存到本机加密文件，不用发到聊天里。' 18
$null = Add-Label ('后台收件邮箱：'+$script:mailProfile.ADMIN_EMAIL) 48
$null = Add-Label 'Resend API Key（新密钥以 re_ 开头；已有密钥不回显）' 90
$keyInput = [Windows.Forms.TextBox]::new()
$keyInput.Location = [Drawing.Point]::new(22,120); $keyInput.Size = [Drawing.Size]::new(606,28)
$keyInput.UseSystemPasswordChar = $true; $keyInput.MaxLength = 256
$form.Controls.Add($keyInput)
$null = Add-Label '发件地址（可先留空，待发信域名验证后配置）' 165
$senderInput = [Windows.Forms.TextBox]::new()
$senderInput.Location = [Drawing.Point]::new(22,195); $senderInput.Size = [Drawing.Size]::new(606,28)
$senderInput.MaxLength = 254
$senderInput.Text = [string]$script:mailProfile.RESEND_FROM
$form.Controls.Add($senderInput)
$message = Add-Label '本工具只保存配置，不发送邮件、不上传 Cloudflare。' 242 42
$save = [Windows.Forms.Button]::new()
$save.Text = '加密保存'; $save.Location = [Drawing.Point]::new(408,305); $save.Size = [Drawing.Size]::new(104,35)
$cancel = [Windows.Forms.Button]::new()
$cancel.Text = '取消'; $cancel.Location = [Drawing.Point]::new(524,305); $cancel.Size = [Drawing.Size]::new(104,35)
$cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
$form.Controls.AddRange(@($save,$cancel)); $form.AcceptButton = $save; $form.CancelButton = $cancel
$save.Add_Click({
    $apiKey = $keyInput.Text.Trim()
    $sender = $senderInput.Text.Trim()
    if (($apiKey -and $apiKey -notmatch '^re_[A-Za-z0-9_-]{10,128}$') -or (!$apiKey -and !$script:mailProfile.RESEND_API_KEY)) { $message.Text = '请粘贴完整的 Resend API Key。'; return }
    if ($sender) {
        try { $mailAddress = [Net.Mail.MailAddress]::new($sender); if ($mailAddress.Host -notmatch '\.' -or $mailAddress.Host -match '\.(invalid|test|example)$') { throw 'Invalid sender' } }
        catch { $message.Text = '请填写有效的发件邮箱，或暂时留空。'; return }
    }
    $raw = $null
    $verifiedBytes = $null
    try {
        $next = @{} + $script:mailProfile
        if ($apiKey) { $next.RESEND_API_KEY = $apiKey }
        if ($sender) { $next.RESEND_FROM = $sender }
        $raw = [Text.Encoding]::UTF8.GetBytes(($next | ConvertTo-Json -Compress))
        $protected = [Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        # Verify the new ciphertext before replacing the existing profile.
        $verifiedBytes = [Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        if ([Convert]::ToBase64String($raw) -cne [Convert]::ToBase64String($verifiedBytes)) { throw 'Encrypted round trip failed' }
        $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json -AsHashtable
        $status.savedAt = [DateTime]::UtcNow.ToString('o')
        $status.savedSecretNames = @($next.Keys | Sort-Object)
        $status.missingSecretNames = @(@('RESEND_API_KEY','RESEND_FROM','RECHARGE_WEBHOOK_SECRET') | Where-Object { -not $next[$_] })
        $status.realEmailSent = $false; $status.mailProviderVerified = $false; $status.cloudSecretsInstalled = $false
        $temporaryProfile = Join-Path (Split-Path $profilePath) ('production.'+[Guid]::NewGuid().ToString('N')+'.tmp')
        [IO.File]::WriteAllBytes($temporaryProfile,$protected)
        [IO.File]::Move($temporaryProfile,$profilePath,$true)
        $status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusPath -Encoding utf8
        $script:mailProfile = $null; $keyInput.Clear(); $form.Tag = 'saved'; $form.Close()
    } catch { $message.Text = '配置未完成保存，请检查本机文件权限后重试。密钥不会写入错误消息。' }
    finally {
        if ($raw) { [Array]::Clear($raw,0,$raw.Length) }
        if ($verifiedBytes) { [Array]::Clear($verifiedBytes,0,$verifiedBytes.Length) }
        $apiKey = $null; $next = $null
    }
})
try {
    $null = $form.ShowDialog()
    if ($form.Tag -eq 'saved') { Write-Output 'Mail configuration encrypted locally. Provider validation, sending, and cloud upload remain pending.' }
    else { Write-Output 'Mail configuration dialog closed without saving.' }
} finally { $keyInput.Clear(); $form.Dispose(); $script:mailProfile = $null }
