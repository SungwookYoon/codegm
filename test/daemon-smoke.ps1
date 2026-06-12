# Standalone daemon lifecycle smoke test.
# Launches the daemon hidden against a throwaway data root, feeds it commands,
# and verifies crossfade/debounce/auto-return/clean-quit via the log + state.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Split-Path -Parent $here
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

$DR = Join-Path $env:TEMP 'ccbgm_clean'
if (Test-Path $DR) { Remove-Item -Recurse -Force $DR }
New-Item -ItemType Directory -Force -Path (Join-Path $DR 'cmd') | Out-Null
@{ volume = 70; crossfade = 600; idleTimeoutMs = 60000; battleIdleMs = 3000; logLevel = 'debug' } |
  ConvertTo-Json | Set-Content (Join-Path $DR 'config.json')

$daemon = Join-Path $pkg 'daemon\cc-bgm-daemon.ps1'
$proc = Start-Process -FilePath $ps -WindowStyle Hidden -PassThru -ArgumentList @(
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
  '-File', $daemon, '-DataRoot', $DR, '-PackageRoot', $pkg
)
Write-Host "daemon pid=$($proc.Id)"
Start-Sleep -Milliseconds 1500

function Drop($line) {
  $name = '{0}-{1}.cmd' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), (Get-Random)
  Set-Content -LiteralPath (Join-Path $DR ('cmd\' + $name)) -Value $line
}

Drop 'ensure village'; Start-Sleep -Milliseconds 1200
Drop 'ensure quest';   Start-Sleep -Milliseconds 800
Drop 'ensure quest';   Drop 'sfx questclear'; Start-Sleep -Milliseconds 1000
Write-Host ("state mid:        " + (Get-Content (Join-Path $DR 'state\daemon.json') -Raw).Trim())
Start-Sleep -Seconds 4   # battleIdle=3000 -> daemon should auto-return to village
Write-Host ("state after idle: " + (Get-Content (Join-Path $DR 'state\daemon.json') -Raw).Trim())
Drop 'quit'; Start-Sleep -Milliseconds 1500
Write-Host ("daemon exited:    " + $proc.HasExited)
Write-Host '=== LOG ==='
Get-Content (Get-ChildItem (Join-Path $DR 'logs') -Filter *.log | Select-Object -First 1).FullName
Write-Host ("state cleaned up: " + (-not (Test-Path (Join-Path $DR 'state\daemon.json'))))
if (-not $proc.HasExited) { $proc.Kill() }
