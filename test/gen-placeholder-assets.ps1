# Generates synthesized placeholder tones for cc-bgm assets so the system works
# out of the box. These are deliberately plain sine tones — replace with real
# CC0 fantasy-RPG music for a shipping build (see assets/CREDITS.md).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Split-Path -Parent $here
$bgm = Join-Path $pkg 'assets\bgm'
$sfx = Join-Path $pkg 'assets\sfx'
New-Item -ItemType Directory -Force -Path $bgm, $sfx | Out-Null
Get-ChildItem $bgm, $sfx -Filter *.wav -ErrorAction SilentlyContinue | Remove-Item -Force

function New-Tone($path, $freq, $durSec, $amp) {
  $sr = 22050; $n = [int]($sr * $durSec)
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $data = $n * 2
  $bw.Write([char[]]'RIFF'); $bw.Write([int](36 + $data)); $bw.Write([char[]]'WAVE')
  $bw.Write([char[]]'fmt '); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]1)
  $bw.Write([int]$sr); $bw.Write([int]($sr * 2)); $bw.Write([int16]2); $bw.Write([int16]16)
  $bw.Write([char[]]'data'); $bw.Write([int]$data)
  $fadeN = [int]($sr * 0.05)
  for ($i = 0; $i -lt $n; $i++) {
    $envv = 1.0
    if ($i -lt $fadeN) { $envv = $i / $fadeN } elseif ($i -gt ($n - $fadeN)) { $envv = ($n - $i) / $fadeN }
    $s = [int16]([math]::Sin(2 * [math]::PI * $freq * $i / $sr) * ($amp * $envv))
    $bw.Write($s)
  }
  [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
}

New-Tone (Join-Path $bgm 'village.wav') 196 2.0 6000
New-Tone (Join-Path $bgm 'quest.wav')   294 2.0 7000
New-Tone (Join-Path $bgm 'dungeon.wav') 147 2.0 7000
New-Tone (Join-Path $bgm 'credits.wav') 262 2.0 5000
New-Tone (Join-Path $sfx 'submit.wav')       659 0.12 8500
New-Tone (Join-Path $sfx 'progress.wav')     988 0.08 6500
New-Tone (Join-Path $sfx 'questclear.wav')   784 0.45 9000
New-Tone (Join-Path $sfx 'error.wav')        131 0.40 9000
New-Tone (Join-Path $sfx 'save.wav')         587 0.18 8000
New-Tone (Join-Path $sfx 'summon.wav')       440 0.30 8000
New-Tone (Join-Path $sfx 'fanfare_soft.wav') 523 0.50 7000

Write-Host 'RPG placeholder tones generated:'
Get-ChildItem $bgm, $sfx -Filter *.wav | ForEach-Object { Write-Host ('  ' + $_.Name) }
