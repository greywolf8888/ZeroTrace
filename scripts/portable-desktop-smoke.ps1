# Extract and launch the portable ZIP as a clean no-install acceptance check.

param(
  [string]$ArchivePath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tauriConfig = Get-Content -LiteralPath (Join-Path $repoRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$stageName = "ZeroTrace-Portable-$($tauriConfig.version)-win-x64"
if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
  $ArchivePath = Join-Path $repoRoot "output\portable\$stageName.zip"
} elseif (-not [System.IO.Path]::IsPathRooted($ArchivePath)) {
  $ArchivePath = Join-Path $repoRoot $ArchivePath
}
$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw "Missing portable archive: $ArchivePath"
}

function Get-Sha256 {
  param([string]$LiteralPath)

  $stream = [System.IO.File]::OpenRead($LiteralPath)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $algorithm.ComputeHash($stream)
    return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

$systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryRoot = Join-Path $systemTemp ("zerotrace-portable-smoke-" + [Guid]::NewGuid().ToString('N'))
$temporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
$tempPrefix = $systemTemp.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar + 'zerotrace-portable-smoke-'
if (-not $temporaryRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe portable smoke temporary path: $temporaryRoot"
}

try {
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $temporaryRoot
  $topLevelDirectories = @(Get-ChildItem -LiteralPath $temporaryRoot -Directory)
  if ($topLevelDirectories.Count -ne 1 -or $topLevelDirectories[0].Name -ne $stageName) {
    throw 'Portable ZIP must contain exactly one versioned top-level directory.'
  }
  $portableRoot = $topLevelDirectories[0].FullName
  $requiredFiles = @(
    'ZeroTrace.exe',
    'zerotrace-api.exe',
    'zerotrace-portable.json',
    'config/paper_portfolios.json',
    '.env.example',
    'README_zh-CN.txt',
    'LICENSE',
    'SHA256SUMS.txt'
  )
  foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $portableRoot $relativePath) -PathType Leaf)) {
      throw "Portable archive is missing required file: $relativePath"
    }
  }
  if (Test-Path -LiteralPath (Join-Path $portableRoot '.env')) {
    throw 'Portable archive must not contain a real .env file.'
  }

  $marker = Get-Content -LiteralPath (Join-Path $portableRoot 'zerotrace-portable.json') -Raw | ConvertFrom-Json
  if ($marker.schemaVersion -ne 'zerotrace-portable-v1' -or $marker.readOnly -ne $true) {
    throw 'Portable marker must be zerotrace-portable-v1 with readOnly=true.'
  }

  $checksumPath = Join-Path $portableRoot 'SHA256SUMS.txt'
  foreach ($line in Get-Content -LiteralPath $checksumPath) {
    if ($line -notmatch '^([0-9a-f]{64})  (.+)$') {
      throw "Malformed SHA256SUMS entry: $line"
    }
    $expectedHash = $Matches[1]
    $relativePath = $Matches[2]
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $portableRoot $relativePath))
    $portablePrefix = $portableRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($portablePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Checksum path escapes portable root: $relativePath"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Checksum target is missing: $relativePath"
    }
    $actualHash = Get-Sha256 -LiteralPath $candidate
    if ($actualHash -ne $expectedHash) {
      throw "Checksum mismatch: $relativePath"
    }
  }

  & (Join-Path $repoRoot 'scripts\desktop-launch-smoke.ps1') `
    -ExecutablePath (Join-Path $portableRoot 'ZeroTrace.exe') `
    -SidecarPath (Join-Path $portableRoot 'zerotrace-api.exe')
  if (-not (Test-Path -LiteralPath (Join-Path $portableRoot 'ZeroTrace-Data\storage-plane') -PathType Container)) {
    throw 'Portable launch did not create the adjacent ZeroTrace-Data storage root.'
  }
  Write-Host "archive SHA256=$(Get-Sha256 -LiteralPath $ArchivePath)"
  Write-Host 'portable extracted launch smoke PASS'
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    if (-not $temporaryRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing portable smoke cleanup outside validated temp path: $temporaryRoot"
    }
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
