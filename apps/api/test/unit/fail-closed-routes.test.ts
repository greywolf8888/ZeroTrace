import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createRuntime } from '../../src/runtime.js';

function baseConfig(): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 8080,
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'silent',
    requestTimeoutMs: 1_000,
    healthCacheTtlMs: 0,
    providerAllowedHosts: [],
    allowPrivateProviderUrls: false,
    providerResilience: {
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      circuitFailureThreshold: 5,
      circuitResetMs: 30_000,
      cacheTtlMs: 0,
      cacheMaxEntries: 100,
    },
    dataQualityMinSources: 2,
    ethereumRpcUrls: [],
    ethereumChainId: 1,
    ethereumSnapshotTag: 'finalized',
    ethereumRequestsPerSecond: 0,
    bscRpcUrls: [],
    bscChainId: 56,
    bscSnapshotTag: 'finalized',
    bscRequestsPerSecond: 0,
    bitcoinEsploraUrls: [],
    bitcoinEsploraRequestsPerSecond: 0,
    solanaRpcUrls: [],
    solanaRequestsPerSecond: 0,
    solanaCommitment: 'finalized',
    sourcifyRequestsPerSecond: 0,
    gmgnConfigured: false,
    jupiterConfigured: false,
    etherscanConfigured: false,
    duneConfigured: false,
    nansenConfigured: false,
    arkhamConfigured: false,
    providerSlotStatus: {
      NODEREAL_API_KEY: 'UNCONFIGURED',
      ANKR_API_KEY: 'UNCONFIGURED',
      CHAINSTACK_BSC_RPC_URL: 'UNCONFIGURED',
      DRPC_API_KEY: 'UNCONFIGURED',
      HELIUS_API_KEY: 'UNCONFIGURED',
      BSC_TRACE_RPC_URL: 'UNCONFIGURED',
    },
    bscTraceRpcAuthType: 'none',
    bscTraceOperatorId: 'bsc-trace-slot',
    storageProfile: 'LOW_COST_CASE',
    storageRoot: '/tmp/zerotrace-fail-closed-routes-test',
    localDevAuth: false,
  };
}

const HEX24 = 'a'.repeat(24);
const TOKEN = `0x${'11'.repeat(20)}`;
const CAMPAIGN = `cc_${HEX24}`;
const SOLANA_SIG = '1'.repeat(64);
const SOLANA_MINT = '1'.repeat(32);
const BITCOIN_TX = 'ab'.repeat(32);

describe('fail-closed durable routes', { timeout: 60_000 }, () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns 503 instead of empty success when durable storage is unconfigured', async () => {
    const config = baseConfig();
    const app = await createApp({ config, runtime: createRuntime(config), logger: false });
    apps.push(app);

    const requests: Array<
      | { method: 'GET'; url: string }
      | { method: 'POST'; url: string; payload: Record<string, unknown> }
    > = [
      { method: 'POST', url: '/api/v1/forensics/cases', payload: { campaignId: CAMPAIGN } },
      { method: 'GET', url: `/api/v1/forensics/cases/fcb_${CAMPAIGN}` },
      { method: 'GET', url: `/api/v1/forensics/cases/fcb_${CAMPAIGN}/export` },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}/timeline` },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}` },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}/evidence-line` },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}/positions` },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}/wallets` },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}/graph?layer=funding` },
      { method: 'GET', url: `/api/v1/control/evidence/cei_${HEX24}` },
      { method: 'POST', url: `/api/v1/control/campaigns/${CAMPAIGN}/replay`, payload: {} },
      { method: 'POST', url: `/api/v1/control/campaigns/${CAMPAIGN}/export`, payload: {} },
      { method: 'GET', url: `/api/v1/control/campaigns/${CAMPAIGN}/export` },
      {
        method: 'GET',
        url: `/api/v1/entities/relationships/timelines/latest?ledger=EVM&chainId=eip155:56&subjectA=wallet-a&subjectB=wallet-b`,
      },
      {
        method: 'GET',
        url: `/api/v1/claims/rules/reports/latest?assetId=eip155:56:erc20:${TOKEN}`,
      },
      { method: 'GET', url: `/api/v1/claims/rules/reports/crr_${HEX24}` },
      {
        method: 'GET',
        url: `/api/v1/claims/verification/reports/latest?assetId=eip155:56:erc20:${TOKEN}`,
      },
      { method: 'GET', url: `/api/v1/claims/verification/reports/cvr_${HEX24}` },
      { method: 'GET', url: `/api/v1/control/events/be_${HEX24}` },
      { method: 'GET', url: `/api/v1/control-campaigns/${CAMPAIGN}/alerts` },
      { method: 'GET', url: `/api/v1/control-campaigns/${CAMPAIGN}/stream` },
      {
        method: 'GET',
        url: `/api/v1/funding-settlement/tokens/eip155:56/${TOKEN}/range?fromBlock=1&toBlock=2`,
      },
      { method: 'GET', url: `/api/v1/funding-settlement/tokens/eip155:56/${TOKEN}` },
      { method: 'GET', url: `/api/v1/funding-settlement/reports/fsr_${HEX24}` },
      { method: 'GET', url: `/api/v1/control/tokens/eip155:56/${TOKEN}/overview` },
      { method: 'GET', url: `/api/v1/control/tokens/eip155:56/${TOKEN}/campaigns` },
      {
        method: 'POST',
        url: `/api/v1/control/tokens/eip155:56/${TOKEN}/backfill`,
        payload: { fromBlock: '1', toBlock: '2' },
      },
      { method: 'GET', url: `/api/v1/control/tokens/eip155:56/${TOKEN}/backfill` },
      {
        method: 'POST',
        url: `/api/v1/control-campaigns/EVM/eip155:56/${TOKEN}/backfills`,
        payload: { fromBlock: '1', toBlock: '2' },
      },
      { method: 'GET', url: `/api/v1/control-campaigns/EVM/eip155:56/${TOKEN}/backfills` },
      {
        method: 'POST',
        url: `/api/v1/control/tokens/eip155:56/${TOKEN}/monitor`,
        payload: { initialFromBlock: '1' },
      },
      {
        method: 'POST',
        url: `/api/v1/control-campaigns/EVM/eip155:56/${TOKEN}/monitors`,
        payload: { initialFromBlock: '1' },
      },
      { method: 'GET', url: `/api/v1/control-campaigns/monitors/cps_${HEX24}` },
      { method: 'GET', url: `/api/v1/control/tokens/eip155:56/${TOKEN}/stream` },
      { method: 'GET', url: `/api/v1/ledger/SOLANA/TRANSACTION/${SOLANA_SIG}/reports/latest` },
      {
        method: 'GET',
        url: `/api/v1/ledger/SOLANA/TRANSACTION/${SOLANA_SIG}/reports/str_${HEX24}`,
      },
      { method: 'GET', url: `/api/v1/solana/dealer-campaigns/sdc_${HEX24}` },
      { method: 'GET', url: `/api/v1/solana/mints/${SOLANA_MINT}/dealer-campaigns/latest` },
      { method: 'GET', url: `/api/v1/bitcoin/forensic-graphs/bfg_${HEX24}` },
      { method: 'GET', url: `/api/v1/bitcoin/transactions/${BITCOIN_TX}/forensic-graphs/latest` },
      {
        method: 'GET',
        url: `/api/v1/actions/semantics/reports/latest?ledger=EVM&chainId=eip155:56&transactionId=0x${'ab'.repeat(32)}`,
      },
      { method: 'GET', url: `/api/v1/actions/semantics/reports/asr_${HEX24}` },
      {
        method: 'GET',
        url: `/api/v1/entities/investigation-graphs/latest?ledger=EVM&chainId=eip155:56&subjectId=wallet-a`,
      },
      {
        method: 'GET',
        url: `/api/v1/entities/investigation-graphs/eig_${HEX24}?ledger=EVM&chainId=eip155:56`,
      },
      {
        method: 'GET',
        url: `/api/v1/entities/investigation-graph-timelines/latest?ledger=EVM&chainId=eip155:56`,
      },
      {
        method: 'GET',
        url: `/api/v1/entities/investigation-graph-timelines/eit_${HEX24}?ledger=EVM&chainId=eip155:56`,
      },
      {
        method: 'POST',
        url: '/api/v1/entities/investigation-graph-timelines/materialize',
        payload: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          graphIds: [`eig_${HEX24}`, `eig_${'b'.repeat(24)}`],
        },
      },
      {
        method: 'GET',
        url: `/api/v1/entities/relationships/reports/latest?ledger=EVM&chainId=eip155:56&subjectA=wallet-a&subjectB=wallet-b`,
      },
      {
        method: 'GET',
        url: `/api/v1/entities/relationships/reports/erh_${HEX24}?ledger=EVM&chainId=eip155:56&subjectA=wallet-a&subjectB=wallet-b`,
      },
      {
        method: 'GET',
        url: `/api/v1/entities/relationships/timelines/ert_${HEX24}?ledger=EVM&chainId=eip155:56&subjectA=wallet-a&subjectB=wallet-b`,
      },
      {
        method: 'GET',
        url: `/api/v1/labels/reports/latest?ledger=EVM&chainId=eip155:56&subjectType=ADDRESS&normalizedIdentifier=${TOKEN}`,
      },
      { method: 'GET', url: `/api/v1/labels/reports/lir_${HEX24}` },
      { method: 'GET', url: `/api/v1/claims/EVM/${TOKEN}/pension-candidates/reports/latest` },
      {
        method: 'GET',
        url: `/api/v1/claims/declarations/reports/latest?assetId=eip155:56:erc20:${TOKEN}`,
      },
      { method: 'GET', url: `/api/v1/claims/declarations/reports/cdr_${HEX24}` },
      {
        method: 'GET',
        url: `/api/v1/control-rights/EVM/${TOKEN}/reports/latest?chainId=eip155:56`,
      },
      {
        method: 'POST',
        url: `/api/v1/control-rights/EVM/${TOKEN}/inspect`,
        payload: { chainId: 'eip155:56' },
      },
      {
        method: 'POST',
        url: `/api/v1/control-rights/SOLANA/${SOLANA_MINT}/inspect`,
        payload: { chainId: 'solana-mainnet' },
      },
    ];

    for (const request of requests) {
      const response =
        request.method === 'GET'
          ? await app.inject({ method: 'GET', url: request.url })
          : await app.inject({ method: 'POST', url: request.url, payload: request.payload });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(503);
    }

    const search = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${TOKEN}&ledger=EVM&chainId=eip155:56`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().durableResults.state).toBe('unavailable');
    expect(search.json().durableResults.reason).toBe('STORAGE_UNCONFIGURED');
  });
});
