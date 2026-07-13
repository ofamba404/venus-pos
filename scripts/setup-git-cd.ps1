# One-time setup: connect GitHub so pushes auto-deploy (no manual netlify deploy).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$configPath = Join-Path $Root "netlify.deploy.json"
if (-not (Test-Path $configPath)) {
    throw "Missing netlify.deploy.json. Bootstrap from push-deploy-netlify skill templates."
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

Write-Host ""
Write-Host "Git continuous deployment setup (one time)"
Write-Host "========================================"
Write-Host ""
Write-Host "1. Netlify will open in your browser."
Write-Host "2. Connect your GitHub repository."
Write-Host "3. Production branch: $($config.productionBranch)"
Write-Host "4. Build command: (leave empty for static sites)"
Write-Host "5. Publish directory: $($config.publishDir)"
Write-Host ""
Write-Host "After connecting, run this script again with -MarkComplete"
Write-Host ""

if ($args -contains "-MarkComplete") {
    $config.gitContinuousDeployment = $true
    $config | ConvertTo-Json -Depth 3 | Set-Content $configPath -Encoding utf8
    Write-Host "Marked gitContinuousDeployment=true in netlify.deploy.json"
    Write-Host "Future runs of ship.ps1 will push only."
    exit 0
}

$linkUrl = if ($config.netlifyAdminUrl) {
    "$($config.netlifyAdminUrl)/link"
} elseif ($config.productionUrl) {
    $siteName = ($config.productionUrl -replace '^https?://', '' -replace '\.netlify\.app.*$', '')
    "https://app.netlify.com/projects/$siteName/link"
} else {
    "https://app.netlify.com"
}

Start-Process $linkUrl
Write-Host "Opened: $linkUrl"
Write-Host ""
Write-Host "Or run interactively in this folder:"
Write-Host "  .\node_modules\.bin\netlify init --git-remote-name origin --force"
Write-Host ""
Write-Host "When finished, run:"
Write-Host "  .\scripts\setup-git-cd.ps1 -MarkComplete"
