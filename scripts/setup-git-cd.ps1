# One-time setup: connect GitHub so pushes auto-deploy (no manual netlify deploy).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host ""
Write-Host "Git continuous deployment setup (one time)"
Write-Host "========================================"
Write-Host ""
Write-Host "1. Netlify will open in your browser."
Write-Host "2. Connect repository: ofamba404/venus-pos"
Write-Host "3. Production branch: master"
Write-Host "4. Build command: (leave empty — static site)"
Write-Host "5. Publish directory: ."
Write-Host ""
Write-Host "After connecting, run this script again with -MarkComplete"
Write-Host ""

if ($args -contains "-MarkComplete") {
    $configPath = Join-Path $Root "netlify.deploy.json"
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $config.gitContinuousDeployment = $true
    $config | ConvertTo-Json -Depth 3 | Set-Content $configPath -Encoding utf8
    Write-Host "Marked gitContinuousDeployment=true in netlify.deploy.json"
    Write-Host "Future runs of ship.ps1 will push only."
    exit 0
}

$netlify = Join-Path $Root "node_modules\.bin\netlify.cmd"
if (-not (Test-Path $netlify)) { $netlify = "netlify" }

Start-Process "https://app.netlify.com/projects/posvenus/link"
Write-Host "Opened Netlify link settings."
Write-Host ""
Write-Host "Or run interactively in this folder:"
Write-Host "  .\node_modules\.bin\netlify init --git-remote-name origin --force"
Write-Host ""
Write-Host "When finished, run:"
Write-Host "  .\scripts\setup-git-cd.ps1 -MarkComplete"
