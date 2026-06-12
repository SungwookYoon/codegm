<#
  cc-bgm audio daemon (Windows PowerShell 5.1 + WPF)

  Owns all audio playback for cc-bgm. Long-lived, hidden, singleton.
  The Node CLI controls it by dropping atomic *.cmd files into <DataRoot>\cmd.

  HARD REQUIREMENT: must run under powershell.exe (5.1 Desktop / .NET Framework).
  WPF (System.Windows.Media.MediaPlayer) is not reliably available under pwsh.

  Lifecycle:
    - Singleton via Named Mutex 'Global\CC_BGM_Daemon' (auto-released on crash).
    - Sets up two BGM "decks" + an SFX pool, then [Dispatcher]::Run() blocks.
    - CommandTimer (~120ms): drains cmd folder, parses, dispatches; idle check.
    - FadeTimer   (~33ms) : runs crossfade / duck ramps; stops itself when idle.

  Volume model per BGM deck:
    Volume = clamp(baseVol * fadeFactor * duckFactor, 0, 1)
    baseVol   = master/100 * trackGain
    fadeFactor= crossfade progress 0..1
    duckFactor= 1.0 normal, duckLevel while an SFX plays
#>

param(
  [Parameter(Mandatory = $true)][string]$DataRoot,
  [Parameter(Mandatory = $true)][string]$PackageRoot
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationCore, WindowsBase

# --------------------------------------------------------------------------
# Paths & logging
# --------------------------------------------------------------------------
$script:CmdDir   = Join-Path $DataRoot 'cmd'
$script:StateDir = Join-Path $DataRoot 'state'
$script:LogsDir  = Join-Path $DataRoot 'logs'
$script:StateFile= Join-Path $StateDir 'daemon.json'
foreach ($d in @($CmdDir, $StateDir, $LogsDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

$script:LogLevel = 'info'
function Write-Log([string]$level, [string]$msg) {
  if ($level -eq 'debug' -and $script:LogLevel -ne 'debug') { return }
  try {
    $file = Join-Path $script:LogsDir ('daemon-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format o), $level, $msg
    Add-Content -LiteralPath $file -Value $line
  } catch { }
}

# --------------------------------------------------------------------------
# Singleton gate
# --------------------------------------------------------------------------
Write-Log 'debug' 'reached mutex gate'
$createdNew = $false
try {
  $script:Mutex = New-Object System.Threading.Mutex($false, 'Global\CC_BGM_Daemon', [ref]$createdNew)
} catch {
  # Global\ namespace can be denied in some contexts; fall back to a session-local mutex.
  Write-Log 'warn' ("Global mutex failed ({0}); using Local" -f $_)
  $script:Mutex = New-Object System.Threading.Mutex($false, 'Local\CC_BGM_Daemon', [ref]$createdNew)
}
if (-not $script:Mutex.WaitOne(0)) {
  Write-Log 'info' 'another daemon holds the mutex; exiting'
  return
}
Write-Log 'info' ("daemon starting pid={0} data={1} pkg={2}" -f $PID, $DataRoot, $PackageRoot)

# --------------------------------------------------------------------------
# Config (live-tunable via `config` command)
# --------------------------------------------------------------------------
$script:Cfg = @{
  crossfade     = 1500
  idleTimeoutMs = 1800000   # 30 min
  battleIdleMs  = 45000     # auto battle->town
  duckLevel     = 0.3
  duckMs        = 250       # duck ramp time
  master        = 0.70      # 0..1
}
# Try to read user config.json for initial values.
try {
  $cfgPath = Join-Path $DataRoot 'config.json'
  if (Test-Path $cfgPath) {
    $u = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
    if ($null -ne $u.crossfade)     { $script:Cfg.crossfade     = [int]$u.crossfade }
    if ($null -ne $u.idleTimeoutMs) { $script:Cfg.idleTimeoutMs = [int]$u.idleTimeoutMs }
    if ($null -ne $u.battleIdleMs)  { $script:Cfg.battleIdleMs  = [int]$u.battleIdleMs }
    if ($null -ne $u.duckLevel)     { $script:Cfg.duckLevel     = [double]$u.duckLevel }
    if ($null -ne $u.volume)        { $script:Cfg.master        = [double]$u.volume / 100.0 }
    if ($null -ne $u.logLevel)      { $script:LogLevel          = [string]$u.logLevel }
  }
} catch { Write-Log 'warn' ("config read failed: {0}" -f $_) }

# --------------------------------------------------------------------------
# Asset resolution: logical name -> file path
#   precedence: user manifest > user convention > bundled manifest > bundled
# --------------------------------------------------------------------------
$script:AudioExt = @('.ogg', '.mp3', '.wav', '.m4a', '.flac')

function Read-Manifest([string]$file) {
  $map = @{}
  try {
    if (Test-Path $file) {
      $j = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
      foreach ($kind in @('bgm', 'sfx')) {
        if ($null -ne $j.$kind) {
          foreach ($prop in $j.$kind.PSObject.Properties) {
            $map["$kind/$($prop.Name)"] = $prop.Value
          }
        }
      }
    }
  } catch { Write-Log 'warn' ("manifest parse failed {0}: {1}" -f $file, $_) }
  return $map
}

$script:UserManifest    = Read-Manifest (Join-Path $DataRoot 'assets\manifest.json')
$script:BundledManifest = Read-Manifest (Join-Path $PackageRoot 'assets\manifest.json')

function Find-ByConvention([string]$root, [string]$kind, [string]$name) {
  $dir = Join-Path $root ("assets\{0}" -f $kind)
  foreach ($ext in $script:AudioExt) {
    $candidate = Join-Path $dir ($name + $ext)
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

# Returns @{ path; gain(dB); loop } or $null. kind = 'bgm' | 'sfx'.
function Resolve-Asset([string]$name, [string]$kind) {
  $key = "$kind/$name"
  $gain = 0.0; $loop = ($kind -eq 'bgm'); $path = $null

  $entry = $null
  if ($script:UserManifest.ContainsKey($key))         { $entry = $script:UserManifest[$key] }
  elseif ($script:BundledManifest.ContainsKey($key))  { $entry = $script:BundledManifest[$key] }

  if ($null -ne $entry) {
    $file = if ($entry -is [string]) { $entry } else { $entry.file }
    if ($entry -isnot [string]) {
      if ($null -ne $entry.gain) { $gain = [double]$entry.gain }
      if ($null -ne $entry.loop) { $loop = [bool]$entry.loop }
    }
    # manifest file may be relative to user assets first, then bundled assets
    foreach ($base in @((Join-Path $DataRoot 'assets'), (Join-Path $PackageRoot 'assets'))) {
      $cand = if ([System.IO.Path]::IsPathRooted($file)) { $file } else { Join-Path $base $file }
      if (Test-Path $cand) { $path = $cand; break }
    }
  }

  if (-not $path) { $path = Find-ByConvention $DataRoot   $kind $name }
  if (-not $path) { $path = Find-ByConvention $PackageRoot $kind $name }

  if (-not $path) { return $null }
  return @{ path = $path; gain = $gain; loop = $loop }
}

function Gain-ToLinear([double]$db) { return [math]::Pow(10.0, $db / 20.0) }

# --------------------------------------------------------------------------
# Players
# --------------------------------------------------------------------------
function New-Deck {
  $mp = New-Object System.Windows.Media.MediaPlayer
  return [pscustomobject]@{
    Player     = $mp
    Track      = $null
    TrackGain  = 1.0      # linear gain from the asset
    BaseVol    = 0.0      # master * trackGain
    FadeFactor = 0.0      # 0..1
    Loop       = $true
  }
}

$script:DeckA = New-Deck
$script:DeckB = New-Deck
$script:Active = 'A'      # which deck currently holds the playing track
$script:CurrentMode = $null   # logical track name on the active deck

# SFX pool
$script:SfxPool = @()
for ($i = 0; $i -lt 6; $i++) { $script:SfxPool += (New-Object System.Windows.Media.MediaPlayer) }
$script:SfxIdx = 0
$script:SfxLast = @{}   # name -> last play ticks (cooldown)

# Looping handlers for decks
function Wire-Deck($deck) {
  $deck.Player.add_MediaEnded({
    param($s, $e)
    try {
      $d = if ($s -eq $script:DeckA.Player) { $script:DeckA } else { $script:DeckB }
      if ($d.Loop) { $d.Player.Position = [TimeSpan]::Zero; $d.Player.Play() }
    } catch { Write-Log 'warn' ("deck loop err: {0}" -f $_) }
  })
}
Wire-Deck $script:DeckA
Wire-Deck $script:DeckB

# --------------------------------------------------------------------------
# Fade / duck state machine
# --------------------------------------------------------------------------
$script:Fade = @{ Mode = 'idle'; StartUtc = $null; DurMs = 1500; Incoming = $null; Outgoing = $null }
$script:Duck = @{ Mode = 'auto'; Target = 1.0; Current = 1.0; Until = $null }

function Get-ActiveDeck { if ($script:Active -eq 'A') { $script:DeckA } else { $script:DeckB } }
function Get-IdleDeck   { if ($script:Active -eq 'A') { $script:DeckB } else { $script:DeckA } }

function Apply-Volume($deck) {
  if (-not $deck.Player.Source) { return }
  $v = $deck.BaseVol * $deck.FadeFactor * $script:Duck.Current
  if ($v -lt 0) { $v = 0 }; if ($v -gt 1) { $v = 1 }
  $deck.Player.Volume = $v
}

function Reapply-AllVolumes {
  Apply-Volume $script:DeckA
  Apply-Volume $script:DeckB
}

function Ensure-FadeTimer { if (-not $script:FadeTimer.IsEnabled) { $script:FadeTimer.Start() } }

function Now-Ms { return [System.Environment]::TickCount }

function Step-Fade {
  $active = Get-ActiveDeck
  $doneFade = $true

  if ($script:Fade.Mode -eq 'crossfade') {
    $t = ([double]((Now-Ms) - $script:Fade.StartUtc)) / [double]$script:Fade.DurMs
    if ($t -lt 0) { $t = 0 }; if ($t -gt 1) { $t = 1 }
    $script:Fade.Incoming.FadeFactor = $t
    $script:Fade.Outgoing.FadeFactor = 1.0 - $t
    Apply-Volume $script:Fade.Incoming
    Apply-Volume $script:Fade.Outgoing
    if ($t -ge 1.0) {
      $out = $script:Fade.Outgoing
      $out.Player.Stop(); $out.Player.Close(); $out.Track = $null
      $script:Fade.Mode = 'idle'
    } else { $doneFade = $false }
  }
  elseif ($script:Fade.Mode -eq 'stopfade') {
    $t = ([double]((Now-Ms) - $script:Fade.StartUtc)) / [double]$script:Fade.DurMs
    if ($t -gt 1) { $t = 1 }
    $active.FadeFactor = 1.0 - $t
    Apply-Volume $active
    if ($t -ge 1.0) {
      $active.Player.Stop(); $active.Player.Close(); $active.Track = $null
      $script:CurrentMode = $null
      $script:Fade.Mode = 'idle'
    } else { $doneFade = $false }
  }

  # Duck easing
  $doneDuck = $true
  if ($script:Duck.Mode -eq 'auto' -and $script:Duck.Until -and (Now-Ms) -gt $script:Duck.Until) {
    $script:Duck.Target = 1.0; $script:Duck.Until = $null
  }
  if ([math]::Abs($script:Duck.Current - $script:Duck.Target) -gt 0.001) {
    $stepSize = 33.0 / [double]$script:Cfg.duckMs
    if ($script:Duck.Current -lt $script:Duck.Target) {
      $script:Duck.Current = [math]::Min($script:Duck.Target, $script:Duck.Current + $stepSize)
    } else {
      $script:Duck.Current = [math]::Max($script:Duck.Target, $script:Duck.Current - $stepSize)
    }
    Reapply-AllVolumes
    $doneDuck = $false
  }

  if ($doneFade -and $doneDuck) { $script:FadeTimer.Stop() }
}

# --------------------------------------------------------------------------
# Command handlers
# --------------------------------------------------------------------------
function Start-Crossfade([string]$name, [int]$durMs) {
  # Debounce: if we're already on (or already transitioning to) this mode, do
  # nothing. CurrentMode is set to the target as soon as a crossfade starts, so
  # this also collapses repeat 'ensure' calls that arrive mid-fade.
  if ($script:CurrentMode -eq $name) {
    Write-Log 'debug' ("ensure {0}: already active/incoming, no-op" -f $name)
    return
  }
  $asset = Resolve-Asset $name 'bgm'
  if (-not $asset) { Write-Log 'warn' ("play: unknown track '{0}'" -f $name); return }

  $incoming = Get-IdleDeck
  $outgoing = Get-ActiveDeck

  $incoming.Loop = $asset.loop
  $incoming.TrackGain = Gain-ToLinear $asset.gain
  $incoming.BaseVol = $script:Cfg.master * $incoming.TrackGain
  $incoming.FadeFactor = 0.0
  $incoming.Track = $name
  $incoming.Player.Open([System.Uri]$asset.path)
  $incoming.Player.Volume = 0.0
  $incoming.Player.Play()

  $hadActive = [bool]$outgoing.Player.Source
  $script:Active = if ($script:Active -eq 'A') { 'B' } else { 'A' }
  $script:CurrentMode = $name

  if ($hadActive) {
    $script:Fade.Mode = 'crossfade'
    $script:Fade.Incoming = $incoming
    $script:Fade.Outgoing = $outgoing
    $script:Fade.DurMs = if ($durMs -gt 0) { $durMs } else { $script:Cfg.crossfade }
    $script:Fade.StartUtc = Now-Ms
    Ensure-FadeTimer
  } else {
    # Nothing was playing — just fade the new one in alone.
    $script:Fade.Mode = 'crossfade'
    $script:Fade.Incoming = $incoming
    $script:Fade.Outgoing = $outgoing  # has no source; Apply-Volume no-ops
    $script:Fade.DurMs = if ($durMs -gt 0) { $durMs } else { $script:Cfg.crossfade }
    $script:Fade.StartUtc = Now-Ms
    Ensure-FadeTimer
  }
  Write-Log 'info' ("crossfade -> {0} ({1}ms)" -f $name, $script:Fade.DurMs)
}

function Start-StopFade([int]$durMs) {
  $active = Get-ActiveDeck
  if (-not $active.Player.Source) { $script:CurrentMode = $null; return }
  $script:Fade.Mode = 'stopfade'
  $script:Fade.DurMs = if ($durMs -gt 0) { $durMs } else { $script:Cfg.crossfade }
  $script:Fade.StartUtc = Now-Ms
  Ensure-FadeTimer
  Write-Log 'info' ("stopfade ({0}ms)" -f $script:Fade.DurMs)
}

function Play-Sfx([string]$name, [double]$gainDb) {
  $asset = Resolve-Asset $name 'sfx'
  if (-not $asset) { Write-Log 'warn' ("sfx: unknown '{0}'" -f $name); return }

  # cooldown: collapse identical SFX bursts (min 400ms apart)
  $now = Now-Ms
  if ($script:SfxLast.ContainsKey($name) -and ($now - $script:SfxLast[$name]) -lt 400) {
    Write-Log 'debug' ("sfx {0}: cooldown skip" -f $name); return
  }
  $script:SfxLast[$name] = $now

  $g = if ($gainDb -ne 0) { $gainDb } else { $asset.gain }
  $player = $script:SfxPool[$script:SfxIdx]
  $script:SfxIdx = ($script:SfxIdx + 1) % $script:SfxPool.Count
  try {
    $player.Stop()
    $player.Open([System.Uri]$asset.path)
    $player.Volume = [math]::Min(1.0, (Gain-ToLinear $g))
    $player.Play()
  } catch { Write-Log 'warn' ("sfx play err: {0}" -f $_); return }

  # auto-duck the BGM under the SFX
  if ($script:Duck.Mode -eq 'auto') {
    $script:Duck.Target = $script:Cfg.duckLevel
    $script:Duck.Until = $now + 1200
    Ensure-FadeTimer
  }
  Write-Log 'debug' ("sfx {0}" -f $name)
}

function Set-Duck([string]$mode) {
  switch ($mode) {
    'on'   { $script:Duck.Mode = 'on';   $script:Duck.Target = $script:Cfg.duckLevel }
    'off'  { $script:Duck.Mode = 'off';  $script:Duck.Target = 1.0 }
    default { $script:Duck.Mode = 'auto'; $script:Duck.Target = 1.0 }
  }
  $script:Duck.Until = $null
  Ensure-FadeTimer
}

function Write-State {
  try {
    $state = @{
      pid       = $PID
      mode      = $script:CurrentMode
      volume    = [int]([math]::Round($script:Cfg.master * 100))
      duck      = $script:Duck.Mode
      updatedAt = (Get-Date -Format o)
    }
    $json = $state | ConvertTo-Json -Compress
    # Write UTF-8 WITHOUT a BOM — Node's JSON.parse rejects a leading BOM.
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($script:StateFile, $json, $enc)
  } catch { Write-Log 'warn' ("state write err: {0}" -f $_) }
}

# Parse a command line into verb + positional + key=value
function Dispatch-Command([string]$line) {
  $script:LastCmdUtc = Now-Ms
  $line = $line.Trim()
  if (-not $line) { return }

  $tokens = $line -split '\s+'
  $verb = $tokens[0].ToLowerInvariant()
  $pos = @(); $kv = @{}
  foreach ($t in ($tokens | Select-Object -Skip 1)) {
    if ($t -match '^(?<k>[^=]+)=(?<v>.*)$') { $kv[$Matches.k] = $Matches.v }
    else { $pos += $t }
  }

  switch ($verb) {
    { $_ -in @('play', 'ensure') } {
      if ($pos.Count -lt 1) { Write-Log 'warn' 'play: no track'; break }
      $fade = if ($kv.ContainsKey('fade')) { [int]$kv['fade'] } else { 0 }
      Start-Crossfade $pos[0] $fade
      # Track "active work" mode so we can auto-return to the idle theme.
      if ($pos[0] -in @('quest', 'dungeon', 'battle')) { $script:LastBattleUtc = Now-Ms }
      break
    }
    'stop' {
      $fade = if ($kv.ContainsKey('fade')) { [int]$kv['fade'] } else { 0 }
      Start-StopFade $fade; break
    }
    'sfx' {
      if ($pos.Count -lt 1) { Write-Log 'warn' 'sfx: no name'; break }
      $gain = if ($kv.ContainsKey('gain')) { [double]$kv['gain'] } else { 0.0 }
      Play-Sfx $pos[0] $gain; break
    }
    'duck'   { Set-Duck ($pos[0]); break }
    'volume' {
      if ($pos.Count -ge 1) {
        $script:Cfg.master = [double]$pos[0] / 100.0
        # re-derive each deck's base volume from its own track gain
        $script:DeckA.BaseVol = $script:Cfg.master * $script:DeckA.TrackGain
        $script:DeckB.BaseVol = $script:Cfg.master * $script:DeckB.TrackGain
        Reapply-AllVolumes; Ensure-FadeTimer
      }
      break
    }
    'config' {
      foreach ($k in $kv.Keys) {
        switch ($k) {
          'idle'      { $script:Cfg.idleTimeoutMs = [int]$kv[$k] }
          'crossfade' { $script:Cfg.crossfade = [int]$kv[$k] }
          'duckLevel' { $script:Cfg.duckLevel = [double]$kv[$k] }
          'battleIdle'{ $script:Cfg.battleIdleMs = [int]$kv[$k] }
          'logLevel'  { $script:LogLevel = [string]$kv[$k] }
        }
      }
      Write-Log 'info' 'config updated'; break
    }
    'ping' { Write-State; break }
    'quit' {
      Write-Log 'info' 'quit received'
      Start-StopFade 300
      $script:QuitTimer = New-Object System.Windows.Threading.DispatcherTimer
      $script:QuitTimer.Interval = [TimeSpan]::FromMilliseconds(400)
      $script:QuitTimer.add_Tick({
        $script:QuitTimer.Stop()
        [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown()
      })
      $script:QuitTimer.Start()
      break
    }
    default { Write-Log 'warn' ("unknown verb '{0}'" -f $verb) }
  }

  # Keep state.json reasonably fresh so `cc-bgm status` reflects reality.
  if ($verb -in @('play', 'ensure', 'stop', 'volume', 'duck')) { Write-State }
}

# --------------------------------------------------------------------------
# Timers + main loop
# --------------------------------------------------------------------------
$script:LastCmdUtc = Now-Ms
$script:LastBattleUtc = 0

# Purge stale .cmd files from a previous crash (> 30s old).
try {
  Get-ChildItem $script:CmdDir -Filter *.cmd -ErrorAction SilentlyContinue |
    Where-Object { ((Get-Date) - $_.LastWriteTime).TotalSeconds -gt 30 } |
    Remove-Item -Force -ErrorAction SilentlyContinue
} catch { }

$script:FadeTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:FadeTimer.Interval = [TimeSpan]::FromMilliseconds(33)
$script:FadeTimer.add_Tick({ try { Step-Fade } catch { Write-Log 'error' ("fade tick: {0}" -f $_) } })

$cmdTimer = New-Object System.Windows.Threading.DispatcherTimer
$cmdTimer.Interval = [TimeSpan]::FromMilliseconds(120)
$cmdTimer.add_Tick({
  try {
    Get-ChildItem $script:CmdDir -Filter *.cmd -ErrorAction SilentlyContinue |
      Sort-Object Name | ForEach-Object {
        $f = $_; $content = $null
        try { $content = (Get-Content -LiteralPath $f.FullName -Raw -ErrorAction Stop) }
        catch { return } # still being written; retry next tick
        Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
        if ($content) {
          foreach ($ln in ($content -split "`n")) { if ($ln.Trim()) { Dispatch-Command $ln } }
        }
      }

    # auto-return to the idle (village) theme if no "work" ensure recently
    if ($script:CurrentMode -in @('quest', 'dungeon', 'battle') -and $script:LastBattleUtc -gt 0 `
        -and ((Now-Ms) - $script:LastBattleUtc) -gt $script:Cfg.battleIdleMs) {
      Write-Log 'info' 'work idle -> village'
      Start-Crossfade 'village' 0
      $script:LastBattleUtc = 0
    }

    # idle self-shutdown
    $idle = (Now-Ms) - $script:LastCmdUtc
    $playing = ($script:DeckA.Player.Source -or $script:DeckB.Player.Source)
    if ($idle -gt $script:Cfg.idleTimeoutMs -and -not $playing) {
      Write-Log 'info' 'idle timeout -> shutdown'
      [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown()
    }
  } catch { Write-Log 'error' ("cmd tick: {0}" -f $_) }
})

Write-State
$cmdTimer.Start()
Write-Log 'info' 'dispatcher running'

try {
  [System.Windows.Threading.Dispatcher]::Run()
} catch {
  # Run() can surface a benign queued exception during/after InvokeShutdown.
  # Cleanup is guaranteed by finally; just record it.
  Write-Log 'warn' ("dispatcher run ended with: {0}" -f $_)
} finally {
  try { $script:DeckA.Player.Close(); $script:DeckB.Player.Close() } catch { }
  try { foreach ($s in $script:SfxPool) { $s.Close() } } catch { }
  try { if (Test-Path $script:StateFile) { Remove-Item -LiteralPath $script:StateFile -Force } } catch { }
  try { $script:Mutex.ReleaseMutex(); $script:Mutex.Dispose() } catch { }
  Write-Log 'info' 'daemon exited'
}
