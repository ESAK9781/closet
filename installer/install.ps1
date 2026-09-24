# The Closet - Windows installer
#
# Sets up everything The Closet needs, for the current user only (no admin rights):
#   1. Finds Python 3.10+ (installs Python 3.12 for this user if there isn't one)
#   2. Creates a private environment in <app>\.venv and installs the dependencies
#   3. Adds "The Closet" shortcuts to the Desktop and Start Menu
#   4. Turns on the git hook that keeps paperwork out of git (if this is a git checkout)
#
# Run it by double-clicking "Install The Closet.bat" in the app folder.
# Safe to run again at any time: it repairs/updates the install and never touches dump\ or metadata\.

param(
    [switch]$NoShortcuts,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$App = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Venv = Join-Path $App ".venv"
$PyVersionForDownload = "3.12.8"

function Say($msg) { Write-Host "  $msg" }
function Step($msg) { Write-Host ""; Write-Host "> $msg" -ForegroundColor Yellow }
function Fail($msg) {
    Write-Host ""
    Write-Host "Install failed: $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Test-Python($exe, [string[]]$pre = @()) {
    try {
        $out = & $exe @pre -c "import sys; print('%d.%d' % sys.version_info[:2]); print(sys.version_info >= (3, 10))" 2>$null
        if ($LASTEXITCODE -eq 0 -and $out -and $out[-1] -eq "True") { return $out[0] }
    } catch {}
    return $null
}

function Find-Python {
    # The Python launcher first, then anything on PATH (skipping the Microsoft Store stub).
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in @("-3.13", "-3.12", "-3.11", "-3.10", "-3")) {
            $ver = Test-Python "py" @($v)
            if ($ver) {
                $exe = & py $v -c "import sys; print(sys.executable)"
                return @{ Exe = $exe.Trim(); Version = $ver }
            }
        }
    }
    foreach ($name in @("python", "python3")) {
        foreach ($cmd in @(Get-Command $name -All -ErrorAction SilentlyContinue)) {
            if ($cmd.Source -like "*\WindowsApps\*") { continue }
            $ver = Test-Python $cmd.Source
            if ($ver) { return @{ Exe = $cmd.Source; Version = $ver } }
        }
    }
    foreach ($dir in @(Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
        $exe = Join-Path $dir.FullName "python.exe"
        if (Test-Path $exe) {
            $ver = Test-Python $exe
            if ($ver) { return @{ Exe = $exe; Version = $ver } }
        }
    }
    return $null
}

function Install-Python {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Say "Installing Python 3.12 with winget (this can take a minute)..."
        & winget install --exact --id Python.Python.3.12 --scope user --silent `
            --accept-package-agreements --accept-source-agreements | Out-Null
        $py = Find-Python
        if ($py) { return $py }
    }
    Say "Downloading Python $PyVersionForDownload from python.org..."
    $arch = if ([Environment]::Is64BitOperatingSystem) { "-amd64" } else { "" }
    $url = "https://www.python.org/ftp/python/$PyVersionForDownload/python-$PyVersionForDownload$arch.exe"
    $tmp = Join-Path $env:TEMP "python-$PyVersionForDownload-installer.exe"
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    Say "Installing Python for this user..."
    $p = Start-Process -FilePath $tmp -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0" -Wait -PassThru
    Remove-Item $tmp -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) { Fail "the Python installer exited with code $($p.ExitCode)." }
    return Find-Python
}

function New-Shortcut($path, $target, $arguments, $workdir, $icon, $description) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $target
    $lnk.Arguments = $arguments
    $lnk.WorkingDirectory = $workdir
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = $description
    $lnk.Save()
}

Write-Host ""
Write-Host "The Closet - installer" -ForegroundColor Cyan
Write-Host "  App folder: $App"

# A running copy would keep serving the old code (and holds files in .venv) - stop it first.
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$App*run.py*" })
if ($running.Count) {
    Step "Closing the running copy of The Closet so it can be updated"
    $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

# ------------------------------------------------------------------ 1. Python
Step "Looking for Python 3.10 or newer"
$py = Find-Python
if (-not $py) {
    Say "Python 3.10+ not found."
    $py = Install-Python
    if (-not $py) { Fail "Python could not be installed automatically. Install Python 3.12 from https://www.python.org/downloads/ and run this installer again." }
}
Say "Using Python $($py.Version) at $($py.Exe)"

# ------------------------------------------------------------------ 2. Environment + dependencies
Step "Setting up The Closet's private Python environment"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$VenvPyw = Join-Path $Venv "Scripts\pythonw.exe"
if ((Test-Path $VenvPy) -and -not (Test-Python $VenvPy)) {
    Say "Existing environment is broken; rebuilding it."
    Remove-Item $Venv -Recurse -Force
}
if (-not (Test-Path $VenvPy)) {
    & $py.Exe -m venv $Venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPy)) { Fail "couldn't create the environment in $Venv." }
}
Say "Environment: $Venv"

Step "Installing dependencies (PyMuPDF, FastAPI, Uvicorn, NumPy, SciPy, dateutil)"
& $VenvPy -m pip install --disable-pip-version-check --quiet --upgrade pip
& $VenvPy -m pip install --disable-pip-version-check --quiet --upgrade -r (Join-Path $App "requirements.txt")
if ($LASTEXITCODE -ne 0) { Fail "pip couldn't install the dependencies. Check the internet connection and run the installer again." }

Step "Checking the install"
Push-Location $App
try {
    & $VenvPy -c "import pymupdf, fastapi, uvicorn, numpy, scipy, dateutil; import closet.records, closet.extract; print('ok')" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "the dependencies installed but The Closet can't import them." }
} finally { Pop-Location }
New-Item -ItemType Directory -Force (Join-Path $App "dump") | Out-Null
foreach ($t in @("F10_nuked_final.pdf", "F174_nuked_final.pdf")) {
    if (-not (Test-Path (Join-Path $App "dump\$t"))) {
        Write-Host "  Warning: template dump\$t is missing - forms can't be read without it." -ForegroundColor Red
    }
}
Say "Everything imports correctly."

# ------------------------------------------------------------------ 3. Shortcuts
if (-not $NoShortcuts) {
    Step "Adding shortcuts"
    $icon = Join-Path $App "assets\closet.ico"
    $run = "`"$(Join-Path $App 'run.py')`" --exit-when-idle"
    $desc = "The Closet - paperwork tracker"
    $desktop = [Environment]::GetFolderPath("Desktop")
    $startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "The Closet.lnk"
    New-Shortcut (Join-Path $desktop "The Closet.lnk") $VenvPyw $run $App $icon $desc
    New-Shortcut $startMenu $VenvPyw $run $App $icon $desc
    Say "Desktop:    $(Join-Path $desktop 'The Closet.lnk')"
    Say "Start Menu: $startMenu"
}

# ------------------------------------------------------------------ 4. Git guard
if ((Test-Path (Join-Path $App ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    & git -C $App config core.hooksPath .githooks
    Say "Git hook on: paperwork and metadata can't be committed."
}

Write-Host ""
Write-Host "The Closet is installed." -ForegroundColor Green
Write-Host "  Put paperwork PDFs in: $(Join-Path $App 'dump')"
Write-Host "  Open it any time from the 'The Closet' shortcut. It closes itself 10 minutes after the last tab is closed."
Write-Host ""

if (-not $NoLaunch -and -not $NoShortcuts) {
    Start-Process -FilePath $VenvPyw -ArgumentList $run -WorkingDirectory $App
}
