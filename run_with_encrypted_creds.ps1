param(
    [string]$BundlePath = ".\secrets\kiro-auth-token.enc.json",
    [string]$Host = "127.0.0.1",
    [int]$Port = 8018,
    [string]$ProxyApiKey = "kiro-local-private-lab"
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

if (-not (Test-Path $BundlePath)) {
    throw "Encrypted credential bundle not found: $BundlePath"
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$tmpDir = Join-Path $root ".tmp-creds"
$tmpCreds = Join-Path $tmpDir "kiro-auth-token.json"

if (-not (Test-Path $venvPython)) {
    python -m venv (Join-Path $root ".venv")
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $root "requirements.txt")
}

$bundle = Get-Content $BundlePath -Raw | ConvertFrom-Json
if ($bundle.format -ne "kiro-creds-aes-gcm-v1") {
    throw "Unsupported bundle format."
}

$passphrase = Read-Passphrase "Enter decryption passphrase"
if ([string]::IsNullOrWhiteSpace($passphrase)) {
    throw "Passphrase cannot be empty."
}

$salt = [Convert]::FromBase64String($bundle.salt)
$nonce = [Convert]::FromBase64String($bundle.nonce)
$tag = [Convert]::FromBase64String($bundle.tag)
$ciphertext = [Convert]::FromBase64String($bundle.ciphertext)

$kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new(
    $passphrase,
    $salt,
    200000,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
)
$key = $kdf.GetBytes(32)
$plaintext = New-Object byte[] $ciphertext.Length
$aes = [System.Security.Cryptography.AesGcm]::new($key, 16)

try {
    $aes.Decrypt($nonce, $ciphertext, $tag, $plaintext)
} catch {
    throw "Failed to decrypt bundle. Wrong passphrase or corrupted file."
} finally {
    $aes.Dispose()
    $kdf.Dispose()
}

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
[System.IO.File]::WriteAllBytes($tmpCreds, $plaintext)

try {
    $env:KIRO_CREDS_FILE = $tmpCreds
    $env:PROXY_API_KEY = $ProxyApiKey
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    & $venvPython -X utf8 (Join-Path $root "main.py") --host $Host --port $Port
} finally {
    if (Test-Path $tmpCreds) {
        Remove-Item $tmpCreds -Force
    }
}
