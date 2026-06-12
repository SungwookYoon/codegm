# End-to-end: simulate a Claude session by piping fake hook JSON through
# `cc-bgm event` and verifying the daemon reacts (via its log).
# Uses the REAL data dir (%LOCALAPPDATA%\cc-bgm) since event.js resolves it.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Split-Path -Parent $here
$bin = Join-Path $pkg 'bin\cc-bgm.js'
$data = Join-Path $env:LOCALAPPDATA 'cc-bgm'

# Use a short battleIdle/idle so the test is quick and self-cleaning.
New-Item -ItemType Directory -Force -Path (Join-Path $data 'cmd') | Out-Null
@{ volume = 60; crossfade = 500; idleTimeoutMs = 60000; battleIdleMs = 3000; logLevel = 'debug' } |
  ConvertTo-Json | Set-Content (Join-Path $data 'config.json')

# fresh log
$logDir = Join-Path $data 'logs'
if (Test-Path $logDir) { Get-ChildItem $logDir -Filter *.log | Remove-Item -Force -ErrorAction SilentlyContinue }

function Hook($json) {
  $json | & node $bin event
}

Write-Host '--- simulating session ---'
Hook '{"hook_event_name":"SessionStart","source":"startup"}'
Start-Sleep -Milliseconds 1500   # daemon lazy-starts here
Hook '{"hook_event_name":"UserPromptSubmit","prompt":"do a thing"}'
Start-Sleep -Milliseconds 600
Hook '{"hook_event_name":"PreToolUse","tool_name":"Bash"}'
Start-Sleep -Milliseconds 400
Hook '{"hook_event_name":"PreToolUse","tool_name":"Bash"}'   # should debounce
Hook '{"hook_event_name":"PostToolUse","tool_name":"Write"}' # save sfx
Start-Sleep -Milliseconds 600
Hook '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash"}' # error sfx
Start-Sleep -Milliseconds 600
Hook '{"hook_event_name":"Stop"}'   # -> village + questclear
Start-Sleep -Milliseconds 1500

Write-Host '--- status (daemon should be running) ---'
& node $bin status

Write-Host '--- shutting down daemon ---'
'{"hook_event_name":"SessionEnd"}' | & node $bin event  # -> stop
Start-Sleep -Milliseconds 500
# also send explicit quit so the daemon exits for the test
Set-Content -LiteralPath (Join-Path $data ('cmd\' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '-quit.cmd')) -Value 'quit'
Start-Sleep -Milliseconds 1200

Write-Host '--- daemon log ---'
Get-Content (Get-ChildItem $logDir -Filter *.log | Select-Object -First 1).FullName
