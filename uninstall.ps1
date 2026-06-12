param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\cc-bgm'),
  [switch]$PurgeData,
  [switch]$KeepPath
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) {
  Write-Host "cc-bgm uninstall: $msg"
}

function Remove-UserPathEntry([string]$binDir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $current) {
    return $false
  }
  $parts = $current.Split(';') | Where-Object { $_ -and $_ -ne $binDir }
  $next = $parts -join ';'
  if ($next -eq $current) {
    return $false
  }
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  $env:Path = (($env:Path -split ';') | Where-Object { $_ -and $_ -ne $binDir }) -join ';'
  return $true
}

$installRoot = [System.IO.Path]::GetFullPath($InstallDir)
$binDir = Join-Path $installRoot 'bin'
$cliScript = Join-Path $installRoot 'bin\cc-bgm.js'

if (Test-Path $cliScript) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $cliArgs = @($cliScript, 'uninstall')
    if ($PurgeData) { $cliArgs += '--purge' }
    & $node.Source @cliArgs
    if ($LASTEXITCODE -ne 0) {
      throw "cc-bgm CLI uninstall failed with exit code $LASTEXITCODE."
    }
  } else {
    Write-Info 'node was not found; skipping CLI uninstall step.'
  }
} else {
  Write-Info 'installed CLI not found; skipping CLI uninstall step.'
}

if ((Test-Path $installRoot) -and ($installRoot -ne [System.IO.Path]::GetPathRoot($installRoot))) {
  Remove-Item -Recurse -Force $installRoot
  Write-Info "removed install directory: $installRoot"
}

if ($KeepPath) {
  Write-Info 'PATH entry was kept by request (--KeepPath).'
} else {
  $removed = Remove-UserPathEntry $binDir
  if ($removed) {
    Write-Info "removed from user PATH: $binDir"
  } else {
    Write-Info 'user PATH did not contain the install bin directory.'
  }
}

Write-Info 'completed.'
