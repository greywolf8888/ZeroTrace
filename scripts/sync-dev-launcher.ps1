# Build the current read-only Tauri application and API sidecar, then refresh
# the workspace desktop shortcut. Native command failures must stop the sync.

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Get-Sha256Hex {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $stream = [System.IO.File]::OpenRead($Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('X2') })
  }
  finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Import-MsvcEnvironment {
  if ($null -ne (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    return
  }

  $candidates = @()
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $installation = & $vswhere `
      -latest `
      -products '*' `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installation)) {
      $candidates += Join-Path $installation.Trim() 'VC\Auxiliary\Build\vcvars64.bat'
    }
  }
  $candidates += @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'),
    (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'),
    (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat')
  )
  $vcvars = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($vcvars)) {
    throw 'MSVC x64 build environment is unavailable. Install Visual Studio Build Tools with the C++ workload.'
  }

  $environment = & $env:ComSpec /d /c "call `"$vcvars`" >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to load MSVC environment from $vcvars"
  }
  foreach ($line in $environment) {
    $separator = $line.IndexOf('=')
    if ($separator -le 0) {
      continue
    }
    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    Set-Item -LiteralPath "Env:$name" -Value $value
  }
  if ($null -eq (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw "MSVC environment loaded from $vcvars but cl.exe is still unavailable."
  }
}

Import-MsvcEnvironment
Invoke-NativeChecked -FilePath 'npm.cmd' -Arguments @('run', 'desktop:prepare')
Invoke-NativeChecked -FilePath 'cargo.exe' -Arguments @(
  'build',
  '-p',
  'zerotrace-desktop',
  '--release'
)

$builtExe = Join-Path $root 'target\release\zerotrace-desktop.exe'
$builtSidecar = Join-Path $root 'target\release\zerotrace-api.exe'
foreach ($artifact in @($builtExe, $builtSidecar)) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Missing current desktop artifact: $artifact"
  }
}

$binDir = Join-Path $root 'apps\desktop\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$exePath = Join-Path $binDir 'ZeroTrace.exe'
$sidecarPath = Join-Path $binDir 'zerotrace-api.exe'
Copy-Item -LiteralPath $builtExe -Destination $exePath -Force
Copy-Item -LiteralPath $builtSidecar -Destination $sidecarPath -Force

$manifest = @{
  schemaVersion = 'zerotrace-desktop-local-artifacts-v1'
  workspaceRoot = $root
  executableSha256 = Get-Sha256Hex -Path $exePath
  sidecarSha256 = Get-Sha256Hex -Path $sidecarPath
} | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  (Join-Path $binDir 'ZeroTrace.workspace.json'),
  $manifest,
  $utf8NoBom
)

$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop -and (Test-Path -LiteralPath $desktop)) {
  $readOnlyName = 'ZeroTrace ' + -join @(
    [char]0x53EA,
    [char]0x8BFB,
    [char]0x5DE5,
    [char]0x4F5C,
    [char]0x7AD9
  )
  $shortcutPath = Join-Path $desktop ($readOnlyName + '.lnk')
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $exePath
  $shortcut.WorkingDirectory = $binDir
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'ZeroTrace read-only workstation (current local source build)'
  $shortcut.Save()
  Write-Host "Refreshed desktop shortcut: $shortcutPath"
}

Write-Host "Desktop application: $exePath"
Write-Host "Read-only API sidecar: $sidecarPath"
