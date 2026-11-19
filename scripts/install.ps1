# Install or update the built `modtree` plugin into ~/.gemini/config/plugins/modtree
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'dist\plugin'
$dst = Join-Path $env:USERPROFILE '.gemini\config\plugins\modtree'

if (-not (Test-Path (Join-Path $src 'plugin.json'))) {
    throw "Built plugin not found at $src. Run 'npm run build' first."
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
Write-Host "Installed/updated modtree plugin at: $dst"
Write-Host "Antigravity discovers plugins under ~/.gemini/config/plugins/ automatically."
