param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PlaywrightArguments
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$apiProcess = $null
$webProcess = $null

function Test-ZeroTraceEndpoint {
  param([string]$Uri)

  try {
    return (Invoke-WebRequest $Uri -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200
  }
  catch {
    return $false
  }
}

function Wait-ZeroTraceEndpoint {
  param(
    [string]$Uri,
    [System.Diagnostics.Process]$Process,
    [string]$Name
  )

  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (Test-ZeroTraceEndpoint $Uri) {
      return
    }
    if ($Process.HasExited) {
      throw "$Name exited before becoming ready (exit code $($Process.ExitCode))."
    }
    Start-Sleep -Milliseconds 250
  }
  throw "$Name did not become ready at $Uri."
}

try {
  $env:NODE_ENV = 'test'
  $env:LOG_LEVEL = 'silent'
  $env:API_PORT = '18081'
  $env:ALCHEMY_API_KEY = ''
  $env:ETH_RPC_URL = ''
  $env:EVM_ETHEREUM_RPC_URL = ''
  $env:EVM_ETHEREUM_RPC_URLS = ''
  $env:BSC_RPC_URL = ''
  $env:EVM_BSC_RPC_URL = ''
  $env:EVM_BSC_RPC_URLS = ''
  $env:BTC_ESPLORA_URL = ''
  $env:BITCOIN_ESPLORA_URL = ''
  $env:BITCOIN_ESPLORA_URLS = ''
  $env:SOLANA_RPC_URL = ''
  $env:SOLANA_RPC_URLS = ''
  $env:POSTGRES_URL = ''
  $env:CLICKHOUSE_URL = ''
  $env:OBJECT_STORE_ENDPOINT = ''
  $env:OBJECT_STORE_ACCESS_KEY = ''
  $env:OBJECT_STORE_SECRET_KEY = ''
  $env:ZEROTRACE_API_PROXY_TARGET = 'http://127.0.0.1:18081'

  if (-not (Test-ZeroTraceEndpoint 'http://127.0.0.1:18081/health/live')) {
    $apiProcess = Start-Process `
      -FilePath $nodeExecutable `
      -ArgumentList 'apps/api/dist/src/server.js' `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -PassThru
    Wait-ZeroTraceEndpoint `
      -Uri 'http://127.0.0.1:18081/health/live' `
      -Process $apiProcess `
      -Name 'ZeroTrace API'
  }

  if (-not (Test-ZeroTraceEndpoint 'http://127.0.0.1:4173')) {
    $webProcess = Start-Process `
      -FilePath $nodeExecutable `
      -ArgumentList @(
        'node_modules/vite/bin/vite.js',
        'preview',
        'apps/web',
        '--host',
        '127.0.0.1',
        '--port',
        '4173'
      ) `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -PassThru
    Wait-ZeroTraceEndpoint `
      -Uri 'http://127.0.0.1:4173' `
      -Process $webProcess `
      -Name 'ZeroTrace web preview'
  }

  $arguments = @('node_modules/@playwright/test/cli.js', 'test') + $PlaywrightArguments
  & $nodeExecutable @arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  foreach ($ownedProcess in @($webProcess, $apiProcess)) {
    if ($null -ne $ownedProcess -and -not $ownedProcess.HasExited) {
      Stop-Process -Id $ownedProcess.Id -Force -ErrorAction SilentlyContinue
      $null = $ownedProcess.WaitForExit(5000)
    }
  }
}
