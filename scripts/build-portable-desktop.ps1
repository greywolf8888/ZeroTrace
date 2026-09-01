# Build a real Windows x64 portable release. The archive never includes .env or credentials.

param(
  [string]$OutputRoot = '',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $repoRoot 'apps\desktop\src-tauri\tauri.conf.json'
$tauriConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$tauriConfig.version
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $repoRoot 'output\portable'
} elseif (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot = Join-Path $repoRoot $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$stageName = "ZeroTrace-Portable-$version-win-x64"
$stagePath = [System.IO.Path]::GetFullPath((Join-Path $OutputRoot $stageName))
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $OutputRoot "$stageName.zip"))

function Assert-StrictDescendant {
  param([string]$Parent, [string]$Child)

  $parentPrefix = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  $childFull = [System.IO.Path]::GetFullPath($Child)
  if (-not $childFull.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing destructive operation outside expected directory: $childFull"
  }
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

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notmatch 'AMD64|ARM64') {
  throw 'ZeroTrace portable Windows release requires a 64-bit Windows host.'
}

if (-not $SkipBuild) {
  Push-Location $repoRoot
  try {
    & npm.cmd run build -w '@zerotrace/desktop' -- --no-bundle
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri portable build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

$releaseDirectory = Join-Path $repoRoot 'target\release'
$desktopExecutable = Join-Path $releaseDirectory 'zerotrace-desktop.exe'
$apiSidecar = Join-Path $releaseDirectory 'zerotrace-api.exe'
$requiredSources = @(
  $desktopExecutable,
  $apiSidecar,
  (Join-Path $repoRoot 'config\paper_portfolios.json'),
  (Join-Path $repoRoot 'apps\desktop\portable\zerotrace-portable.json'),
  (Join-Path $repoRoot 'apps\desktop\portable\README_zh-CN.txt'),
  (Join-Path $repoRoot '.env.example'),
  (Join-Path $repoRoot 'LICENSE')
)
foreach ($source in $requiredSources) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing portable release source: $source"
  }
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
Assert-StrictDescendant -Parent $OutputRoot -Child $stagePath
Assert-StrictDescendant -Parent $OutputRoot -Child $archivePath
if (Test-Path -LiteralPath $stagePath) {
  Remove-Item -LiteralPath $stagePath -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

$configDirectory = Join-Path $stagePath 'config'
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
Copy-Item -LiteralPath $desktopExecutable -Destination (Join-Path $stagePath 'ZeroTrace.exe')
Copy-Item -LiteralPath $apiSidecar -Destination (Join-Path $stagePath 'zerotrace-api.exe')
Copy-Item -LiteralPath (Join-Path $repoRoot 'config\paper_portfolios.json') -Destination $configDirectory
Copy-Item -LiteralPath (Join-Path $repoRoot 'apps\desktop\portable\zerotrace-portable.json') -Destination $stagePath
Copy-Item -LiteralPath (Join-Path $repoRoot 'apps\desktop\portable\README_zh-CN.txt') -Destination $stagePath
Copy-Item -LiteralPath (Join-Path $repoRoot '.env.example') -Destination $stagePath
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination $stagePath

$checksumPath = Join-Path $stagePath 'SHA256SUMS.txt'
$stagePrefix = $stagePath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$checksumLines = Get-ChildItem -LiteralPath $stagePath -File -Recurse |
  Where-Object { $_.FullName -ne $checksumPath } |
  Sort-Object FullName |
  ForEach-Object {
    if (-not $_.FullName.StartsWith($stagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Portable checksum source escapes staging root: $($_.FullName)"
    }
    $relativePath = $_.FullName.Substring($stagePrefix.Length).Replace('\', '/')
    $hash = Get-Sha256 -LiteralPath $_.FullName
    "$hash  $relativePath"
  }
Set-Content -LiteralPath $checksumPath -Value $checksumLines -Encoding Ascii

Compress-Archive -LiteralPath $stagePath -DestinationPath $archivePath -CompressionLevel Optimal
$archiveHash = Get-Sha256 -LiteralPath $archivePath
$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $stagePath 'ZeroTrace.exe')

Write-Host "portable directory=$stagePath"
Write-Host "portable archive=$archivePath"
Write-Host "archive SHA256=$archiveHash"
Write-Host "code signature=$($signature.Status)"
Write-Host 'portable build PASS'
