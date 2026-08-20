# Real launch smoke: start the workspace-linked EXE, wait for API+web, then stop.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root

$exe = Join-Path $root 'apps\desktop\bin\ZeroTrace.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Error "Missing $exe. Run npm run desktop:sync first."
}

$outLog = Join-Path $root 'apps\desktop\bin\launch-stdout.txt'
$errLog = Join-Path $root 'apps\desktop\bin\launch-stderr.txt'
Remove-Item -LiteralPath $outLog, $errLog -ErrorAction SilentlyContinue

function Test-Listen([int]$Port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300)
    $connected = $ok -and $client.Connected
    if ($ok) { $client.EndConnect($iar) }
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

if ((Test-Listen 5173) -or (Test-Listen 8080)) {
  Write-Error 'Refusing smoke start: port 5173 or 8080 is already in use.'
}

Write-Host "Starting $exe"
$proc = Start-Process -FilePath $exe -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddMinutes(5)
$ready = $false
try {
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
      Write-Host '--- stdout ---'
      if (Test-Path $outLog) { Get-Content -LiteralPath $outLog }
      Write-Host '--- stderr ---'
      if (Test-Path $errLog) { Get-Content -LiteralPath $errLog }
      Write-Error "Launcher exited before ready. status=$($proc.ExitCode)"
    }
    if ((Test-Listen 5173) -and (Test-Listen 8080)) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    Write-Error 'Timed out waiting for 127.0.0.1:5173 and :8080'
  }

  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 15
  $web = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 15
  Write-Host ("health status={0} bytes={1}" -f [int]$health.StatusCode, $health.RawContentLength)
  Write-Host ("web status={0} bytes={1}" -f [int]$web.StatusCode, $web.RawContentLength)
  if ([int]$health.StatusCode -ge 500) {
    Write-Error 'API /health returned 5xx'
  }
  if ([int]$web.StatusCode -ne 200) {
    Write-Error 'Vite root did not return 200'
  }
  if ($web.Content -notmatch 'ZeroTrace' -and $web.Content -notmatch 'root') {
    Write-Host 'Web body did not include expected markers; dumping first 200 chars'
    Write-Host $web.Content.Substring(0, [Math]::Min(200, $web.Content.Length))
  }
  Write-Host 'desktop launch smoke PASS'
} finally {
  if ($null -ne $proc) {
    & taskkill.exe /F /T /PID $proc.Id | Out-Null
  }
}
