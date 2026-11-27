<#
.SYNOPSIS
  Setup, build, and run MyAiRouter on Windows.
.DESCRIPTION
  Installs Node.js and Go (if missing or outdated), installs web dependencies,
  builds the frontend (web/dist) and Go binary (myairouter.exe), and runs it.
.PARAMETER NoRun
  Install dependencies and build myairouter.exe without starting it.
.PARAMETER InstallOnly
  Only ensure Node.js and Go are installed.
.PARAMETER Foreground
  Run myairouter.exe in foreground mode (start -f).
#>
[CmdletBinding()]
param(
    [switch]$NoRun,
    [switch]$InstallOnly,
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

function Write-Step([string]$msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Refresh-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $combined = @($machinePath, $userPath) | Where-Object { $_ } | Join-String -Separator ';'
    if ($combined) {
        $env:Path = $combined
    }
    # Common default install locations in case registry hasn't propagated yet
    foreach ($dir in @("$env:ProgramFiles\Go\bin", "$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\nodejs")) {
        if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {
            $env:Path = "$dir;$env:Path"
        }
    }
}

function Has-Command([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-NodeJS {
    if (Has-Command 'node' -and Has-Command 'npm') {
        $ver = (& node -v).Trim()
        Write-Host "Node.js already installed: $ver" -ForegroundColor Green
        return
    }

    Write-Step 'Installing Node.js LTS...'
    if (Has-Command 'winget') {
        & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent
    } elseif (Has-Command 'choco') {
        & choco install nodejs-lts -y
    } elseif (Has-Command 'scoop') {
        & scoop install nodejs-lts
    } else {
        Write-Host 'Package manager not found; downloading Node.js LTS installer from nodejs.org...' -ForegroundColor Yellow
        $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
        $lts = $index | Where-Object { $_.lts -ne $false } | Select-Object -First 1
        if (-not $lts) { throw 'Could not resolve latest Node.js LTS release.' }
        $ver = $lts.version
        $msiUrl = "https://nodejs.org/dist/$ver/node-$ver-$arch.msi"
        $msiPath = Join-Path $env:TEMP "node-$ver-$arch.msi"
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        if ($proc.ExitCode -ne 0) { throw "Node.js MSI installer failed with exit code $($proc.ExitCode)." }
    }

    Refresh-SessionPath
    if (-not (Has-Command 'node')) {
        throw 'Node.js installation finished, but `node` is still not on PATH. Open a new terminal and re-run.'
    }
    Write-Host "Node.js installed: $((& node -v).Trim())" -ForegroundColor Green
}

function Get-RequiredGoVersion {
    $goMod = Join-Path $RepoRoot 'go.mod'
    if (Test-Path $goMod) {
        $match = Select-String -Path $goMod -Pattern '^go\s+(\d+\.\d+(?:\.\d+)?)' | Select-Object -First 1
        if ($match) {
            return [version]$match.Matches[0].Groups[1].Value
        }
    }
    return [version]'1.26.0'
}

function Get-InstalledGoVersion {
    if (-not (Has-Command 'go')) { return $null }
    $raw = (& go version) -join ' '
    if ($raw -match 'go(\d+\.\d+(?:\.\d+)?)') {
        return [version]$Matches[1]
    }
    return $null
}

function Install-Go {
    $required = Get-RequiredGoVersion
    $installed = Get-InstalledGoVersion
    if ($installed -and $installed -ge $required) {
        Write-Host "Go already installed: go$installed (requires >= $required)" -ForegroundColor Green
        return
    }

    if ($installed) {
        Write-Step "Upgrading Go (found go$installed, requires >= $required)..."
    } else {
        Write-Step "Installing Go (>= $required)..."
    }

    if (Has-Command 'winget') {
        if ($installed) {
            & winget upgrade --id GoLang.Go -e --accept-package-agreements --accept-source-agreements --silent
        } else {
            & winget install --id GoLang.Go -e --accept-package-agreements --accept-source-agreements --silent
        }
    } elseif (Has-Command 'choco') {
        & choco upgrade golang -y
    } elseif (Has-Command 'scoop') {
        if ($installed) { & scoop update go } else { & scoop install go }
    } else {
        Write-Host 'Package manager not found; downloading Go installer from go.dev...' -ForegroundColor Yellow
        $releases = Invoke-RestMethod 'https://go.dev/dl/?mode=json'
        $latest = $releases | Where-Object { $_.stable -eq $true } | Select-Object -First 1
        if (-not $latest) { throw 'Could not resolve latest stable Go release.' }
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
        $file = $latest.files | Where-Object { $_.os -eq 'windows' -and $_.arch -eq $arch -and $_.kind -eq 'installer' } | Select-Object -First 1
        if (-not $file) { throw "No Windows $arch Go installer found for $($latest.version)." }
        $msiUrl = "https://go.dev/dl/$($file.filename)"
        $msiPath = Join-Path $env:TEMP $file.filename
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        if ($proc.ExitCode -ne 0) { throw "Go MSI installer failed with exit code $($proc.ExitCode)." }
    }

    Refresh-SessionPath
    $after = Get-InstalledGoVersion
    if (-not $after) {
        throw 'Go installation finished, but `go` is still not on PATH. Open a new terminal and re-run.'
    }
    Write-Host "Go installed: go$after" -ForegroundColor Green
}

Write-Step 'Checking toolchain (Node.js & Go)'
Install-NodeJS
Install-Go

if ($InstallOnly) {
    Write-Host "`nToolchain setup complete." -ForegroundColor Green
    exit 0
}

Write-Step 'Installing frontend dependencies & building web UI'
Push-Location (Join-Path $RepoRoot 'web')
try {
    if ((Test-Path 'package-lock.json')) {
        & npm ci
    } else {
        & npm install
    }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency install failed.' }

    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally {
    Pop-Location
}

Write-Step 'Building Go binary (myairouter.exe)'
& go build -o (Join-Path $RepoRoot 'myairouter.exe') .
if ($LASTEXITCODE -ne 0) { throw 'Go build failed.' }
Write-Host 'Built myairouter.exe successfully.' -ForegroundColor Green

if ($NoRun) {
    Write-Host "`nDone (-NoRun specified). Start manually with: .\myairouter.exe" -ForegroundColor Cyan
    exit 0
}

Write-Step 'Starting MyAiRouter'
$exe = Join-Path $RepoRoot 'myairouter.exe'
if ($Foreground) {
    & $exe start -f
} else {
    & $exe
}
