# Find a usable Node, or fetch one, then start the app.
#
# Windows half of scripts/bootstrap-node.sh. Same contract: nothing is
# installed system-wide, nothing needs admin, and the runtime lives in a
# folder inside this project that can be deleted.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$NodeMin = 22

function Test-NodeOk([string]$Path) {
  if (-not $Path) { return $false }
  try {
    $v = & $Path -v 2>$null
    if (-not $v) { return $false }
    return [int](($v.TrimStart('v') -split '\.')[0]) -ge $NodeMin
  } catch { return $false }
}

function Find-Node {
  # One this launcher fetched earlier wins, so a machine with an old system
  # Node does not re-download every time.
  $own = Join-Path $Root '.runtime\node\node.exe'
  if (Test-NodeOk $own) { return $own }

  $onPath = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (Test-NodeOk $onPath) { return $onPath }

  foreach ($c in @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:APPDATA\npm\node.exe"
  )) { if (Test-NodeOk $c) { return $c } }

  return $null
}

function Install-Node {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $dist = "https://nodejs.org/dist/latest-v$NodeMin.x"

  Write-Host ''
  Write-Host "  Node $NodeMin+ is needed and was not found. Fetching it (about 50 MB, once) ..."

  # The filename comes from the release's own checksum list rather than being
  # guessed, so this keeps working as new versions land.
  $sums = (Invoke-WebRequest -UseBasicParsing "$dist/SHASUMS256.txt").Content
  $file = ([regex]::Match($sums, "node-v[\d.]+-win-$arch\.zip")).Value
  if (-not $file) { Write-Host "  No Node build published for win-$arch."; return $null }
  $version = [regex]::Match($file, '^node-(v[\d.]+)-').Groups[1].Value

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp $file
  Invoke-WebRequest -UseBasicParsing "$dist/$file" -OutFile $zip

  # Verify before executing. This binary is about to be run.
  $expected = ([regex]::Match($sums, "([0-9a-f]{64})\s+$([regex]::Escape($file))")).Groups[1].Value
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Remove-Item -Recurse -Force $tmp
    Write-Host '  Checksum mismatch - the download was corrupted or tampered with. Stopping.'
    return $null
  }

  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $runtime = Join-Path $Root '.runtime'
  if (-not (Test-Path $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
  $dest = Join-Path $runtime 'node'
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Move-Item (Join-Path $tmp "node-$version-win-$arch") $dest
  Remove-Item -Recurse -Force $tmp

  $exe = Join-Path $dest 'node.exe'
  if (Test-NodeOk $exe) {
    Write-Host "  Installed Node $version inside this folder."
    return $exe
  }
  return $null
}

$node = Find-Node
if (-not $node) {
  try { $node = Install-Node } catch { Write-Host "  Could not reach nodejs.org: $_" }
}

if (-not $node) {
  Write-Host ''
  Write-Host '  Could not find or install Node.'
  Write-Host ''
  Write-Host '  Install it from https://nodejs.org (take the LTS build),'
  Write-Host '  then double-click start.bat again.'
  Write-Host ''
  exit 1
}

& $node (Join-Path $Root 'scripts\launch.mjs')
exit $LASTEXITCODE
