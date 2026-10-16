# Bind the existing encrypted production seed. No network, email or cloud writes.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ([IO.Path]::GetPathRoot($project) -ne 'D:\') { throw 'Production enrollment must stay on D:.' }
$env:TEMP = Join-Path $project 'artifacts/local/tmp'; $env:TMP = $env:TEMP
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    $helper = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"')) -WindowStyle Hidden -Wait -PassThru
    exit $helper.ExitCode
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$profilePath = Join-Path $project 'artifacts/cloudflare/.secrets/production.dpapi'
$statusPath = Join-Path $project 'artifacts/cloudflare/prepared/production-local-status.json'
$configPath = Join-Path $project 'artifacts/cloudflare/prepared/wrangler.json'
$node = 'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (!(Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe).Source }
$clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($profilePath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try { $script:enrollmentProfile = [Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json -AsHashtable } finally { [Array]::Clear($clear,0,$clear.Length) }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$domain = [string]$config.routes[0].pattern
function Invoke-EnrollmentHelper([string]$action,[string]$code='') {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $node
    $start.ArgumentList.Add((Join-Path $project 'scripts/cloudflare/admin-enrollment.mjs'))
    $start.WorkingDirectory = $project; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($start)
    $payload = @{action=$action; secret=$script:enrollmentProfile.ADMIN_TOTP_SECRET; username=$script:enrollmentProfile.ADMIN_USERNAME; domain=$domain; code=$code}
    try {
        $child.StandardInput.WriteLine(($payload | ConvertTo-Json -Compress)); $child.StandardInput.Close()
        $out = $child.StandardOutput.ReadToEnd(); $errorOutput = $child.StandardError.ReadToEnd(); $child.WaitForExit()
        if ($child.ExitCode -ne 0) { throw 'Local enrollment helper failed; sensitive output withheld.' }
        return ($out | ConvertFrom-Json)
    } finally { $payload = $null; $out = $null; $errorOutput = $null; $child.Dispose() }
}
$imageStream = $null; $form = $null; $qrImage = $null
try {
    $preview = Invoke-EnrollmentHelper 'preview'
    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json -AsHashtable
    if ($status.totpEnrollmentCompleted -and $status.totpCredentialHash -eq $preview.fingerprint) { Write-Output 'Production authenticator enrollment is already verified for the current credentials.'; return }
    $imageBytes = [Convert]::FromBase64String($preview.image.Substring($preview.image.IndexOf(',')+1))
    $imageStream = [IO.MemoryStream]::new($imageBytes)
    $qrImage = [Drawing.Image]::FromStream($imageStream)
    $preview.image = $null
    [Windows.Forms.Application]::EnableVisualStyles()
    $form = [Windows.Forms.Form]::new()
    $form.Text = 'GPTibo · 绑定正式后台验证器'
    $form.ClientSize = [Drawing.Size]::new(720,485)
    $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $form.Font = [Drawing.Font]::new('Microsoft YaHei UI',10)
    function Add-EnrollmentLabel([string]$text,[int]$left,[int]$top,[int]$width,[int]$height) {
        $label = [Windows.Forms.Label]::new(); $label.Text = $text
        $label.Location = [Drawing.Point]::new($left,$top); $label.Size = [Drawing.Size]::new($width,$height); $form.Controls.Add($label)
    }
    Add-EnrollmentLabel '请用手机验证器添加账户并扫描二维码。二维码只显示在本机，不要发到聊天。' 20 18 680 45
    $picture = [Windows.Forms.PictureBox]::new(); $picture.Name = 'EnrollmentQr'
    $picture.Location = [Drawing.Point]::new(20,75); $picture.Size = [Drawing.Size]::new(300,300)
    $picture.Image = $qrImage; $picture.SizeMode = 'Normal'; $form.Controls.Add($picture)
    Add-EnrollmentLabel ('后台用户名：'+$script:enrollmentProfile.ADMIN_USERNAME+"`n域名："+$domain) 340 80 355 65
    Add-EnrollmentLabel "在 Microsoft Authenticator / Google Authenticator 等验证器中添加其他账户。`n`n扫码后，在下方填写手机显示的 6 位动态码。" 340 155 350 100
    $inputCode = [Windows.Forms.TextBox]::new(); $inputCode.Name = 'AuthenticatorCode'
    $inputCode.Location = [Drawing.Point]::new(340,270); $inputCode.Size = [Drawing.Size]::new(355,32); $inputCode.MaxLength = 6
    $form.Controls.Add($inputCode)
    $manual = [Windows.Forms.CheckBox]::new(); $manual.Text = '无法扫码时显示手动添加密钥'; $manual.Location = [Drawing.Point]::new(22,382); $manual.Size = [Drawing.Size]::new(305,26)
    $form.Controls.Add($manual)
    $seedBox = [Windows.Forms.TextBox]::new(); $seedBox.Name = 'ManualSeed'; $seedBox.ReadOnly = $true; $seedBox.UseSystemPasswordChar = $true
    $seedBox.Location = [Drawing.Point]::new(22,413); $seedBox.Size = [Drawing.Size]::new(305,28); $seedBox.Visible = $false
    $seedBox.Text = [string]$script:enrollmentProfile.ADMIN_TOTP_SECRET; $form.Controls.Add($seedBox)
    $manual.Add_CheckedChanged({ $seedBox.Visible = $manual.Checked; $seedBox.UseSystemPasswordChar = !$manual.Checked })
    $message = [Windows.Forms.Label]::new(); $message.Text = '只在手机实际动态码验证通过后记录绑定完成。'; $message.Location = [Drawing.Point]::new(340,320); $message.Size = [Drawing.Size]::new(355,68); $form.Controls.Add($message)
    $save = [Windows.Forms.Button]::new(); $save.Text = '验证并完成绑定'; $save.Location = [Drawing.Point]::new(340,405); $save.Size = [Drawing.Size]::new(215,40)
    $cancel = [Windows.Forms.Button]::new(); $cancel.Text = '稍后绑定'; $cancel.Location = [Drawing.Point]::new(575,405); $cancel.Size = [Drawing.Size]::new(120,40)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($save,$cancel)); $form.AcceptButton = $save; $form.CancelButton = $cancel
    $save.Add_Click({
        if ($inputCode.Text -notmatch '^\d{6}$') { $message.Text = '请填写手机验证器显示的 6 位数字。'; return }
        try {
            $result = Invoke-EnrollmentHelper 'verify' $inputCode.Text
            if (!$result.verified -or $result.fingerprint -ne $preview.fingerprint) { $message.Text = '动态码不正确。请确认手机已开启自动时间，再输入最新号码。'; return }
            $current = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json -AsHashtable
            $current.totpEnrollmentCompleted = $true; $current.totpCredentialHash = [string]$result.fingerprint
            $current.totpEnrollmentVerifiedAt = [DateTime]::UtcNow.ToString('o')
            $temporaryStatus = Join-Path (Split-Path $statusPath) ('enrollment.'+[Guid]::NewGuid().ToString('N')+'.tmp')
            $current | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryStatus -Encoding utf8
            [IO.File]::Move($temporaryStatus,$statusPath,$true)
            $inputCode.Clear(); $form.Tag = 'verified'; $form.Close()
        } catch { $message.Text = '本机验证未完成，请重试。密钥和动态码不会写入错误信息。' }
    })
    $null = $form.ShowDialog()
    if ($form.Tag -eq 'verified') { Write-Output 'Production authenticator enrollment verified locally; credentials were not replaced or uploaded.' }
    else { Write-Output 'Authenticator enrollment deferred; credentials unchanged and enrollment not marked complete.' }
} finally {
    if ($seedBox) { $seedBox.Clear() }; if ($inputCode) { $inputCode.Clear() }; if ($form) { $form.Dispose() }
    if ($qrImage) { $qrImage.Dispose() }; if ($imageStream) { $imageStream.Dispose() }; if ($imageBytes) { [Array]::Clear($imageBytes,0,$imageBytes.Length) }
    $script:enrollmentProfile = $null; $preview = $null
}
