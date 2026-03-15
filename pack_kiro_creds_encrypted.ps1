param(
    [string]$SourcePath = "$HOME\.aws\sso\cache\kiro-auth-token.json",
    [string]$OutputPath = ".\secrets\kiro-auth-token.enc.json"
)

$ErrorActionPreference = "Stop"

function Read-Passphrase([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not (Test-Path $SourcePath)) {
    throw "Credential file not found: $SourcePath"
}

$pass1 = Read-Passphrase "Enter encryption passphrase"
$pass2 = Read-Passphrase "Confirm encryption passphrase"

if ([string]::IsNullOrWhiteSpace($pass1)) {
    throw "Passphrase cannot be empty."
}

if ($pass1 -ne $pass2) {
    throw "Passphrases do not match."
}

$plaintext = [System.IO.File]::ReadAllBytes((Resolve-Path $SourcePath))
$salt = New-Object byte[] 16
$nonce = New-Object byte[] 12
[System.Security.Cryptography.RandomNumberGenerator]::Fill($salt)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($nonce)

$kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new(
    $pass1,
    $salt,
    200000,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
)
$key = $kdf.GetBytes(32)

$ciphertext = New-Object byte[] $plaintext.Length
$tag = New-Object byte[] 16
$aes = [System.Security.Cryptography.AesGcm]::new($key, 16)
$aes.Encrypt($nonce, $plaintext, $ciphertext, $tag)
$aes.Dispose()
$kdf.Dispose()

$payload = [ordered]@{
    format     = "kiro-creds-aes-gcm-v1"
    createdAt  = (Get-Date).ToString("o")
    sourceName = (Split-Path $SourcePath -Leaf)
    salt       = [Convert]::ToBase64String($salt)
    nonce      = [Convert]::ToBase64String($nonce)
    tag        = [Convert]::ToBase64String($tag)
    ciphertext = [Convert]::ToBase64String($ciphertext)
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$payload | ConvertTo-Json -Depth 5 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "Encrypted credential bundle written to $OutputPath"
Write-Host "Commit the encrypted file, not the original token file."
