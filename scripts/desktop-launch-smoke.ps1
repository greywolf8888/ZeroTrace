# Real current-source Tauri smoke: start the app with its packaged read-only API
# sidecar, verify dynamic loopback/auth/window state, then reclaim owned processes.

param(
  [string]$ExecutablePath = '',
  [string]$SidecarPath = ''
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Resolve-SmokePath {
  param([string]$Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $root $Path))
}

$explicitArtifacts = -not [string]::IsNullOrWhiteSpace($ExecutablePath) -or
  -not [string]::IsNullOrWhiteSpace($SidecarPath)
if ($explicitArtifacts -and (
    [string]::IsNullOrWhiteSpace($ExecutablePath) -or
    [string]::IsNullOrWhiteSpace($SidecarPath)
  )) {
  throw 'ExecutablePath and SidecarPath must be provided together.'
}
if ($explicitArtifacts) {
  $exe = Resolve-SmokePath -Path $ExecutablePath
  $sidecar = Resolve-SmokePath -Path $SidecarPath
  $binDir = Split-Path -Parent $exe
  if ((Split-Path -Parent $sidecar) -ne $binDir -or (Split-Path -Leaf $sidecar) -ne 'zerotrace-api.exe') {
    throw 'The release sidecar must be zerotrace-api.exe beside the selected executable.'
  }
} else {
  $binDir = Join-Path $root 'apps\desktop\bin'
  $exe = Join-Path $binDir 'ZeroTrace.exe'
  $sidecar = Join-Path $binDir 'zerotrace-api.exe'
}
foreach ($artifact in @($exe, $sidecar)) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Missing desktop smoke artifact: $artifact"
  }
}

$outLog = Join-Path $binDir 'launch-stdout.txt'
$errLog = Join-Path $binDir 'launch-stderr.txt'
Remove-Item -LiteralPath $outLog, $errLog -ErrorAction SilentlyContinue
$portableMode = Test-Path -LiteralPath (Join-Path $binDir 'zerotrace-portable.json') -PathType Leaf
$workstationTitle = 'ZeroTrace ' + (-join @(
  [char]0x94FE,
  [char]0x4E0A,
  [char]0x53D6,
  [char]0x8BC1,
  [char]0x5DE5,
  [char]0x4F5C,
  [char]0x7AD9
))
$expectedTitle = if ($portableMode) {
  $workstationTitle + ' ' + [char]0x00B7 + ' ' + (-join @(
    [char]0x4FBF,
    [char]0x643A,
    [char]0x7248
  ))
} else {
  $workstationTitle
}

function Get-DescendantProcessIds {
  param([int]$RootProcessId)

  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
  $pending = [System.Collections.Generic.Queue[int]]::new()
  $pending.Enqueue($RootProcessId)
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $result = @()
  while ($pending.Count -gt 0) {
    $parent = $pending.Dequeue()
    foreach ($child in $all | Where-Object { [int]$_.ParentProcessId -eq $parent }) {
      $childId = [int]$child.ProcessId
      if ($seen.Add($childId)) {
        $result += $child
        $pending.Enqueue($childId)
      }
    }
  }
  return $result
}

function Get-AnonymousHealthStatus {
  param([int]$Port)

  try {
    $response = Invoke-WebRequest `
      -Uri "http://127.0.0.1:$Port/health" `
      -UseBasicParsing `
      -TimeoutSec 5
    return [int]$response.StatusCode
  }
  catch {
    if ($null -ne $_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

$processName = [System.IO.Path]::GetFileNameWithoutExtension($exe)
$existing = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -eq $exe } catch { $false }
})
if ($existing.Count -gt 0) {
  throw "Refusing smoke start: current workspace app is already running (PID $($existing.Id -join ','))."
}

$proc = $null
$ownedIds = @()
$notificationSmokeName = 'ZEROTRACE_DESKTOP_NOTIFICATION_SMOKE'
$priorNotificationSmoke = [Environment]::GetEnvironmentVariable($notificationSmokeName, 'Process')
[Environment]::SetEnvironmentVariable($notificationSmokeName, '1', 'Process')
try {
  Write-Host "Starting $exe"
  $proc = Start-Process `
    -FilePath $exe `
    -WorkingDirectory $binDir `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru `
    -WindowStyle Hidden
  $deadline = (Get-Date).AddMinutes(3)
  $apiPort = $null
  $windowReady = $false
  $webViewReady = $false
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
      Write-Host '--- stdout ---'
      if (Test-Path -LiteralPath $outLog) { Get-Content -LiteralPath $outLog }
      Write-Host '--- stderr ---'
      if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog }
      throw "Desktop application exited before ready (exit code $($proc.ExitCode))."
    }

    $main = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    $windowReady = $null -ne $main -and
      $main.Responding -and
      $main.MainWindowTitle -eq $expectedTitle
    $descendants = @(Get-DescendantProcessIds -RootProcessId $proc.Id)
    $sidecarProcess = $descendants | Where-Object { $_.Name -ieq 'zerotrace-api.exe' } | Select-Object -First 1
    $webViewReady = @($descendants | Where-Object { $_.Name -ieq 'msedgewebview2.exe' }).Count -gt 0
    if ($null -ne $sidecarProcess) {
      $listener = Get-NetTCPConnection `
        -OwningProcess ([int]$sidecarProcess.ProcessId) `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
        Select-Object -First 1
      if ($null -ne $listener) {
        $apiPort = [int]$listener.LocalPort
      }
    }
    if ($windowReady -and $webViewReady -and $null -ne $apiPort) {
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $windowReady) {
    throw 'Chinese Tauri main window did not become responsive.'
  }
  if (-not $webViewReady) {
    throw 'WebView2 child process did not become ready.'
  }
  if ($null -eq $apiPort) {
    throw 'Read-only API sidecar did not expose a dynamic loopback listener.'
  }
  $anonymousStatus = Get-AnonymousHealthStatus -Port $apiPort
  if ($anonymousStatus -ne 401) {
    throw "Anonymous desktop health request must fail closed with 401; got $anonymousStatus."
  }
  $receiptDeadline = (Get-Date).AddSeconds(10)
  $smokeReceipts = ''
  do {
    $smokeReceipts = if (Test-Path -LiteralPath $outLog) {
      Get-Content -LiteralPath $outLog -Raw
    } else {
      ''
    }
    if (
      $smokeReceipts -match 'ZEROTRACE_DESKTOP_NOTIFICATION_SMOKE=OS_API_ACCEPTED' -and
      $smokeReceipts -match 'ZEROTRACE_DESKTOP_AUTH_SMOKE=HEALTH_200' -and
      $smokeReceipts -match 'ZEROTRACE_PAPER_SETTINGS_SMOKE=HTTP_200'
    ) {
      break
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $receiptDeadline)
  if ($smokeReceipts -notmatch 'ZEROTRACE_DESKTOP_NOTIFICATION_SMOKE=OS_API_ACCEPTED') {
    throw 'Tauri notification plugin did not return an OS API acceptance receipt.'
  }
  if ($smokeReceipts -notmatch 'ZEROTRACE_DESKTOP_AUTH_SMOKE=HEALTH_200') {
    throw 'Desktop sidecar did not pass authenticated health smoke.'
  }
  if ($smokeReceipts -notmatch 'ZEROTRACE_PAPER_SETTINGS_SMOKE=HTTP_200') {
    throw 'Desktop sidecar did not load the versioned paper portfolio settings.'
  }

  $second = Start-Process -FilePath $exe -WorkingDirectory $binDir -PassThru -WindowStyle Hidden
  try {
    if (-not $second.WaitForExit(10000)) {
      throw 'Second desktop launch did not yield to the single-instance owner.'
    }
  }
  finally {
    if (-not $second.HasExited) {
      & taskkill.exe /F /T /PID $second.Id | Out-Null
    }
  }

  $ownedIds = @($proc.Id) + @(
    Get-DescendantProcessIds -RootProcessId $proc.Id | ForEach-Object { [int]$_.ProcessId }
  )
  Write-Host "window title=$expectedTitle"
  Write-Host "dynamic API port=$apiPort anonymousStatus=$anonymousStatus"
  Write-Host "portableMode=$portableMode paperSettings=pass authenticatedHealth=pass"
  Write-Host 'WebView2=ready singleInstance=pass OSNotification=accepted'
  Write-Host 'desktop launch smoke PASS'
}
finally {
  [Environment]::SetEnvironmentVariable(
    $notificationSmokeName,
    $priorNotificationSmoke,
    'Process'
  )
  if ($null -ne $proc -and -not $proc.HasExited) {
    & taskkill.exe /F /T /PID $proc.Id | Out-Null
    $null = $proc.WaitForExit(10000)
  }
  Start-Sleep -Milliseconds 500
  $survivors = @($ownedIds | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
  if ($survivors.Count -gt 0) {
    throw "Owned desktop processes survived cleanup: $($survivors -join ',')"
  }
}
