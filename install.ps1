param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\cc-bgm'),
  [switch]$NoPath
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) {
  Write-Host "cc-bgm install: $msg"
}

function Get-NodeExe() {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Node.js 18+ is required. Install Node first, then re-run install.ps1."
  }
  return $cmd.Source
}

function Assert-NodeVersion([string]$nodeExe) {
  $versionText = & $nodeExe --version
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to run node --version."
  }
  $major = [int](($versionText -replace '^[vV]', '').Split('.')[0])
  if ($major -lt 18) {
    throw "Node.js 18+ is required. Found $versionText."
  }
}

function Ensure-UserPath([string]$binDir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @()
  if ($current) {
    $parts = $current.Split(';') | Where-Object { $_ }
  }
  if ($parts -contains $binDir) {
    return $false
  }
  $next = @($parts + $binDir) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  if (-not (($env:Path -split ';') -contains $binDir)) {
    $env:Path = ($env:Path.TrimEnd(';') + ';' + $binDir).Trim(';')
  }
  return $true
}

$sourceRoot = $PSScriptRoot
$nodeExe = Get-NodeExe
Assert-NodeVersion $nodeExe

$installRoot = [System.IO.Path]::GetFullPath($InstallDir)
$sourceFull = [System.IO.Path]::GetFullPath($sourceRoot)
if ($installRoot -eq $sourceFull) {
  throw "InstallDir must not be the same as the extracted source folder."
}

$binDir = Join-Path $installRoot 'bin'
$cliScript = Join-Path $installRoot 'bin\cc-bgm.js'
$cmdShim = Join-Path $binDir 'cc-bgm.cmd'

Write-Info "source:  $sourceFull"
Write-Info "target:  $installRoot"
Write-Info "node:    $nodeExe"

if (Test-Path $installRoot) {
  Remove-Item -Recurse -Force $installRoot
}
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$items = @('assets', 'bin', 'config', 'daemon', 'src', 'package.json', 'README.md', 'LICENSE')
foreach ($item in $items) {
  $src = Join-Path $sourceRoot $item
  if (-not (Test-Path $src)) {
    throw "Expected install payload missing: $item"
  }
  Copy-Item -Recurse -Force $src $installRoot
}

$cmdContent = @"
@echo off
"$nodeExe" "$cliScript" %*
"@
[System.IO.File]::WriteAllText($cmdShim, $cmdContent, [System.Text.Encoding]::ASCII)

$pathAdded = $false
if (-not $NoPath) {
  $pathAdded = Ensure-UserPath $binDir
}

Write-Info 'installed successfully.'
Write-Info "command: $cmdShim"
if ($NoPath) {
  Write-Info 'PATH update skipped by request (--NoPath).'
} elseif ($pathAdded) {
  Write-Info "added to user PATH: $binDir"
} else {
  Write-Info 'user PATH already contained the install bin directory.'
}

Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Open a fresh terminal if `cc-bgm` is not found immediately.'
Write-Host '  2. Run: cc-bgm doctor'
Write-Host '  3. Run: cc-bgm init --abs'
Write-Host '  4. Optional: cc-bgm fetch starter'
