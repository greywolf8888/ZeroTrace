# Build the workstation EXE only when launcher sources change, then refresh the
# desktop shortcut and workspace sidecar. Application source updates do not
# require regenerating the EXE.

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root

$sourceRel = @(
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/desktop/src-tauri/src/main.rs',
  'crates/zerotrace-desktop-core/Cargo.toml',
  'crates/zerotrace-desktop-core/src/lib.rs',
  'crates/zerotrace-desktop-core/src/launcher.rs'
)

$missing = @($sourceRel | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) })
if ($missing.Count -gt 0) {
  Write-Error ("Missing launcher sources: {0}" -f ($missing -join ', '))
}

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  foreach ($rel in $sourceRel) {
    $path = Join-Path $root $rel
    $bytes = [System.IO.File]::ReadAllBytes($path)
    [void]$sha.TransformBlock($bytes, 0, $bytes.Length, $null, 0)
    $nameBytes = [System.Text.Encoding]::UTF8.GetBytes(($rel -replace '\\', '/'))
    [void]$sha.TransformBlock($nameBytes, 0, $nameBytes.Length, $null, 0)
  }
  [void]$sha.TransformFinalBlock([byte[]]::new(0), 0, 0)
  $hash = -join ($sha.Hash | ForEach-Object { $_.ToString('x2') })
} finally {
  $sha.Dispose()
}

$binDir = Join-Path $root 'apps\desktop\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$exeName = if ($env:OS -eq 'Windows_NT') { 'ZeroTrace.exe' } else { 'zerotrace-desktop' }
$exePath = Join-Path $binDir $exeName
$stampPath = Join-Path $binDir 'launcher.sha256'
$sidecarPath = Join-Path $binDir 'ZeroTrace.workspace.json'

$previous = ''
if (Test-Path -LiteralPath $stampPath) {
  $previous = (Get-Content -LiteralPath $stampPath -Raw -Encoding ASCII).Trim()
}

$needBuild = -not (Test-Path -LiteralPath $exePath) -or ($previous -ne $hash)
if ($needBuild) {
  Write-Host 'Launcher sources changed or EXE is missing; compiling once.'
  cargo build -p zerotrace-desktop --release
  $built = Join-Path $root 'target\release\zerotrace-desktop.exe'
  if (-not (Test-Path -LiteralPath $built)) {
    $built = Join-Path $root 'target/release/zerotrace-desktop'
  }
  if (-not (Test-Path -LiteralPath $built)) {
    Write-Error "Missing cargo artifact: $built"
  }
  Copy-Item -LiteralPath $built -Destination $exePath -Force
  Set-Content -LiteralPath $stampPath -Value $hash -Encoding ASCII
  Write-Host "Updated $exePath"
} else {
  Write-Host 'Launcher EXE matches source digest; skipping rebuild.'
}

$pointer = @{
  schemaVersion = 'zerotrace-desktop-workspace-pointer-v1'
  workspaceRoot = $root
} | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($sidecarPath, $pointer, $utf8NoBom)
Write-Host "Wrote workspace pointer $sidecarPath"

if ($env:OS -eq 'Windows_NT') {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if ($desktop -and (Test-Path -LiteralPath $desktop)) {
    $name = 'ZeroTrace ' + -join @([char]0x53EA, [char]0x8BFB, [char]0x5DE5, [char]0x4F5C, [char]0x7AD9)
    $shortcutPath = Join-Path $desktop ($name + '.lnk')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exePath
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 1
    $shortcut.Description = 'ZeroTrace read-only workstation (workspace-linked; no rebuild for app edits)'
    $shortcut.Save()
    Write-Host "Refreshed desktop shortcut: $shortcutPath"
  }
}

Write-Host 'App source edits do not require regenerating this EXE.'
