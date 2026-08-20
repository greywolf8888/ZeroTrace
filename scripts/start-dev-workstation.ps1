# Starts or attaches to the live ZeroTrace workstation (npm run dev).
# No-Rust fallback; the EXE is a pointer to the same workspace.

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$linkPath = Join-Path $root 'apps\desktop\dev-link.json'
if (-not (Test-Path -LiteralPath $linkPath)) {
  Write-Error "Missing dev-link.json: $linkPath"
}

$link = Get-Content -LiteralPath $linkPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($link.schemaVersion -ne 'zerotrace-desktop-dev-link-v1') {
  Write-Error "Unsupported dev-link schemaVersion: $($link.schemaVersion)"
}
if ($link.readOnly -ne $true) {
  Write-Error 'Launcher refused a non-read-only configuration.'
}

function Test-Listen([string]$HostName, [int]$Port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300)
    if ($ok -and $client.Connected) {
      $client.EndConnect($iar)
      $client.Close()
      return $true
    }
    $client.Close()
    return $false
  } catch {
    return $false
  }
}

function Open-Workstation([string]$Url) {
  Start-Process $Url | Out-Null
}

$webHost = [string]$link.web.host
$webPort = [int]$link.web.port
$apiHost = [string]$link.api.host
$apiPort = [int]$link.api.port
$webUrl = "http://${webHost}:${webPort}"
if ($link.web.path -and $link.web.path -ne '/') {
  $webUrl = "http://${webHost}:${webPort}$($link.web.path)"
}

$webUp = Test-Listen $webHost $webPort
$apiUp = Test-Listen $apiHost $apiPort

Write-Host 'ZeroTrace read-only workstation launcher'
Write-Host "Workspace: $root"
Write-Host "Workstation: $webUrl"

if ($webUp -and $apiUp) {
  Write-Host 'Dev servers already running; attaching without a second npm run dev.'
  Write-Host 'Source changes hot-reload; do not rebuild the EXE for app edits.'
  Open-Workstation $webUrl
  exit 0
}

if ($webUp -xor $apiUp) {
  Write-Error 'Service conflict: web and API must both be up or both down. Check the existing npm run dev window.'
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
  Write-Error 'Missing node_modules. Run npm ci in the workspace first.'
}

if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) {
  Write-Host 'No .env found; API starts with defaults. Unconfigured providers stay Unknown, never zero.'
}

$program = [string]$link.spawn.program
$spawnArgs = @($link.spawn.args)
Write-Host ("Starting {0} {1} (same command as the dev terminal)." -f $program, ($spawnArgs -join ' '))

$timeoutMs = 180000
if ($link.waitTimeoutMs) { $timeoutMs = [int]$link.waitTimeoutMs }
$pollMs = 500
if ($link.pollIntervalMs) { $pollMs = [int]$link.pollIntervalMs }

$cmdArgs = @('/C', $program) + $spawnArgs
$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WorkingDirectory $root -NoNewWindow -PassThru
$deadline = [datetime]::UtcNow.AddMilliseconds($timeoutMs)
$opened = $false
try {
  while (-not $proc.HasExited) {
    if (-not $opened -and (Test-Listen $webHost $webPort) -and (Test-Listen $apiHost $apiPort)) {
      Write-Host 'Dev servers ready. Closing this window stops this npm run dev.'
      Open-Workstation $webUrl
      $opened = $true
    }
    if (-not $opened -and [datetime]::UtcNow -gt $deadline) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      Write-Error 'Timed out waiting for API/Web. Inspect npm output or run npm run dev manually.'
    }
    Start-Sleep -Milliseconds $pollMs
  }
  if (-not $opened) {
    Write-Error "Dev servers exited before the workstation was ready. status=$($proc.ExitCode)"
  }
  exit $proc.ExitCode
} finally {
  if ($null -ne $proc -and -not $proc.HasExited) {
    & taskkill.exe /F /T /PID $proc.Id | Out-Null
  }
}
