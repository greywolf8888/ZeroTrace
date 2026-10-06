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
  param(
    [string]$Uri,
    [string]$ExpectedContent
  )

  try {
    $response = Invoke-WebRequest $Uri -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200 -and $response.Content.Contains($ExpectedContent)
  }
  catch {
    return $false
  }
}

function Wait-ZeroTraceEndpoint {
  param(
    [string]$Uri,
    [string]$ExpectedContent,
    [System.Diagnostics.Process]$Process,
    [string]$Name,
    [int]$TimeoutSeconds = 180
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if (Test-ZeroTraceEndpoint -Uri $Uri -ExpectedContent $ExpectedContent) {
      return
    }
    if ($Process.HasExited) {
      throw "$Name exited before becoming ready (exit code $($Process.ExitCode))."
    }
    Start-Sleep -Milliseconds 250
  }
  throw "$Name did not become ready at $Uri within $TimeoutSeconds seconds."
}

try {
  $webPort = 14173
  if (-not [string]::IsNullOrWhiteSpace($env:ZEROTRACE_E2E_WEB_PORT)) {
    $parsedWebPort = 0
    if (-not [int]::TryParse($env:ZEROTRACE_E2E_WEB_PORT, [ref]$parsedWebPort) -or
      $parsedWebPort -lt 1024 -or $parsedWebPort -gt 65535) {
      throw 'ZEROTRACE_E2E_WEB_PORT must be an integer from 1024 through 65535.'
    }
    $webPort = $parsedWebPort
  }
  $webUri = "http://127.0.0.1:$webPort"
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
  $env:ZEROTRACE_E2E_WEB_PORT = $webPort.ToString()

  if (-not (Test-ZeroTraceEndpoint -Uri 'http://127.0.0.1:18081/health/live' -ExpectedContent 'zerotrace-api')) {
    $apiProcess = Start-Process `
      -FilePath $nodeExecutable `
      -ArgumentList 'tests/e2e/isolated-api.mjs' `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -PassThru
    Wait-ZeroTraceEndpoint `
      -Uri 'http://127.0.0.1:18081/health/live' `
      -ExpectedContent 'zerotrace-api' `
      -Process $apiProcess `
      -Name 'ZeroTrace API'
  }

  if (-not (Test-ZeroTraceEndpoint -Uri $webUri -ExpectedContent 'ZeroTrace')) {
    $webProcess = Start-Process `
      -FilePath $nodeExecutable `
      -ArgumentList @(
        'node_modules/vite/bin/vite.js',
        'preview',
        'apps/web',
        '--host',
        '127.0.0.1',
        '--port',
        $webPort.ToString()
      ) `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -PassThru
    Wait-ZeroTraceEndpoint `
      -Uri $webUri `
      -ExpectedContent 'ZeroTrace' `
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
