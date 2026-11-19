# Uninstall `modtree` user-level plugin cleanly.
$ErrorActionPreference = 'Stop'
$dst = Join-Path $env:USERPROFILE '.gemini\config\plugins\modtree'

if (Test-Path $dst) {
    try {
        Remove-Item -Recurse -Force $dst
        Write-Host "Removed plugin directory: $dst"
    } catch {
        Write-Warning "Could not remove $dst while the sidecar process holds a directory lock."
        Write-Host "Please disable/uninstall 'modtree' in Antigravity Customizations UI first, then re-run this script."
        throw
    }
} else {
    Write-Host "Plugin directory not found (already uninstalled): $dst"
}
