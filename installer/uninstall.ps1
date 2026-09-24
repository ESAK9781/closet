# The Closet - uninstaller
# Removes the shortcuts and the private Python environment.
# Your paperwork (dump\) and everything The Closet recorded (metadata\) are left untouched.

$ErrorActionPreference = "Stop"
$App = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host ""
Write-Host "The Closet - uninstall" -ForegroundColor Cyan

# Stop a running copy so its files can be removed
Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$App*run.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "  Stopped the running app." }

foreach ($lnk in @(
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "The Closet.lnk"),
        (Join-Path ([Environment]::GetFolderPath("Programs")) "The Closet.lnk"))) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "  Removed $lnk" }
}
$venv = Join-Path $App ".venv"
if (Test-Path $venv) { Remove-Item $venv -Recurse -Force; Write-Host "  Removed $venv" }

Write-Host ""
Write-Host "Uninstalled. dump\ and metadata\ were kept; delete the folder yourself if you want them gone." -ForegroundColor Green
Write-Host ""
