param(
    [string]$Host = "127.0.0.1",
    [int]$Port = 8018,
    [string]$ProxyApiKey = "kiro-local-private-lab"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $root ".venv\Scripts\python.exe"
$defaultCreds = Join-Path $HOME ".aws\sso\cache\kiro-auth-token.json"

if (-not (Test-Path $venvPython)) {
    python -m venv (Join-Path $root ".venv")
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $root "requirements.txt")
}

if (-not $env:PROXY_API_KEY) {
    $env:PROXY_API_KEY = $ProxyApiKey
}

if (-not $env:KIRO_CREDS_FILE -and -not (Test-Path (Join-Path $root ".env"))) {
    if (Test-Path $defaultCreds) {
        $env:KIRO_CREDS_FILE = $defaultCreds
    }
}

if (-not $env:KIRO_CREDS_FILE -and -not (Test-Path (Join-Path $root ".env"))) {
    throw "No Kiro credentials found. Log in to Kiro first or create a local .env file."
}

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

& $venvPython -X utf8 (Join-Path $root "main.py") --host $Host --port $Port
