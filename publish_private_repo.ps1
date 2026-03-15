param(
    [string]$RepoName = "kiro-gateway-private-lab-20260315"
)

$ErrorActionPreference = "Stop"

if (-not $env:GITHUB_PAT) {
    throw "GITHUB_PAT is not set."
}

$headers = @{
    Authorization         = "Bearer $($env:GITHUB_PAT)"
    Accept                = "application/vnd.github+json"
    "User-Agent"          = "codex-local-upload"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$user = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/user" -Method Get
$login = $user.login

$createBody = @{
    name        = $RepoName
    private     = $true
    auto_init   = $false
    description = "Private local lab snapshot for Kiro gateway testing"
} | ConvertTo-Json

try {
    $repo = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/user/repos" -Method Post -Body $createBody -ContentType "application/json"
} catch {
    throw "GitHub repo creation failed. Check that GITHUB_PAT is valid and has repo permissions."
}

$remoteUrl = $repo.clone_url

git remote remove origin 2>$null
git remote add origin $remoteUrl

$bytes = [System.Text.Encoding]::ASCII.GetBytes("x-access-token:$($env:GITHUB_PAT)")
$basic = [Convert]::ToBase64String($bytes)

git -c http.extraheader="AUTHORIZATION: basic $basic" push -u origin main

Write-Host "Published to $($repo.html_url)"
