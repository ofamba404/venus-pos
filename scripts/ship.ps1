# Fast push + deploy for Netlify projects
# Usage: .\scripts\ship.ps1 "Optional commit message"
param(
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$configPath = Join-Path $Root "netlify.deploy.json"
if (-not (Test-Path $configPath)) {
    throw "Missing netlify.deploy.json. Bootstrap from push-deploy-netlify skill templates."
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

function Get-NetlifyCli {
    $local = Join-Path $Root "node_modules\.bin\netlify.cmd"
    if (Test-Path $local) { return $local }
    return "netlify"
}

function Get-GitHubNoreplyEmail {
    $remote = git remote get-url origin 2>$null
    if ($remote -match 'github\.com[:/]([^/]+)') {
        return "$($Matches[1])@users.noreply.github.com"
    }
    return $null
}

function Set-CommitIdentity {
    $email = Get-GitHubNoreplyEmail
    if (-not $email) { return }
    $name = git log -1 --format="%an" 2>$null
    if (-not $name) { $name = "Git User" }
    $env:GIT_AUTHOR_EMAIL = $email
    $env:GIT_COMMITTER_EMAIL = $email
    $env:GIT_AUTHOR_NAME = $name
    $env:GIT_COMMITTER_NAME = $name
}

function Test-GitContinuousDeployment {
    if ($config.gitContinuousDeployment -eq $true) { return $true }

    if (-not $config.siteId) { return $false }

    $netlify = Get-NetlifyCli
    try {
        $payload = "{`"site_id`":`"$($config.siteId)`"}"
        $site = & $netlify api getSite --data $payload 2>$null | ConvertFrom-Json
        return [bool]$site.build_settings.repo_url
    } catch {
        return $false
    }
}

function Invoke-GitCommand {
    param([string[]]$GitArgs)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & git @GitArgs 2>&1 | Out-String
        return @{
            ExitCode = $LASTEXITCODE
            Output = $output
        }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Invoke-GitPush {
    param([string]$Branch)

    $result = Invoke-GitCommand -GitArgs @("push", "-u", "origin", $Branch)
    if ($result.ExitCode -eq 0) { return }

    if ($result.Output -notmatch "GH007") {
        throw "git push failed: $($result.Output)"
    }

    $email = Get-GitHubNoreplyEmail
    $name = $env:GIT_AUTHOR_NAME
    if (-not $email) { throw "git push blocked by GH007 and GitHub noreply email could not be derived." }

    git commit --amend --author="$name <$email>" --no-edit
    if ($LASTEXITCODE -ne 0) { throw "Failed to amend commit author for GH007." }

    $retry = Invoke-GitCommand -GitArgs @("push", "-u", "origin", $Branch)
    if ($retry.ExitCode -ne 0) { throw "git push failed after GH007 fix: $($retry.Output)" }
}

Set-CommitIdentity

$branch = git branch --show-current
if (-not $branch) { throw "Not on a git branch." }

git add -A
$pending = git status --porcelain
if ($pending) {
    if (-not $Message) { $Message = "Deploy update." }
    git commit -m $Message
    if ($LASTEXITCODE -ne 0) { throw "git commit failed." }
    Write-Host "Committed changes."
} else {
    Write-Host "No changes to commit."
}

$commit = git rev-parse --short HEAD
Invoke-GitPush -Branch $branch
Write-Host "Pushed $branch @ $commit"

$productionUrl = if ($config.productionUrl) { $config.productionUrl } else { "(see Netlify dashboard)" }

if (Test-GitContinuousDeployment) {
    Write-Host "Git continuous deployment is enabled - Netlify will build from the push."
    Write-Host "Production: $productionUrl"
    exit 0
}

$publishDir = if ($config.publishDir) { $config.publishDir } else { "." }
$netlify = Get-NetlifyCli
Write-Host "Deploying to Netlify production..."
& $netlify deploy --prod --dir $publishDir --message "ship $commit"
if ($LASTEXITCODE -ne 0) { throw "Netlify deploy failed." }

Write-Host "Done. Production: $productionUrl"
