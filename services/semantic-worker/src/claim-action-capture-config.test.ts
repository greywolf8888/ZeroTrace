import { describe, expect, it } from 'vitest';

import { loadClaimActionsCaptureWorkerConfig } from './claim-action-capture-config.js';

const baseEnv = {
  POSTGRES_URL: 'postgresql://worker@database.example/zerotrace',
  EVM_BSC_RPC_URL: 'https://bsc.example/',
  SQD_PORTAL_URL: 'https://portal.sqd.dev/',
  CLAIM_CAPTURE_WORKER_OWNER: 'capture-worker',
};

describe('Claim Actions capture worker configuration', () => {
  it('loads safe public-provider defaults and supports explicit one-shot mode', () => {
    expect(loadClaimActionsCaptureWorkerConfig(baseEnv, ['--once'])).toMatchObject({
      postgresUrl: baseEnv.POSTGRES_URL,
      bscRpcUrls: ['https://bsc.example/'],
      sqdPortalUrl: 'https://portal.sqd.dev/',
      providerAllowedHosts: ['bsc.example'],
      sqdAllowedHosts: ['portal.sqd.dev'],
      allowPrivateProviderUrls: false,
      owner: 'capture-worker',
      once: true,
      requestTimeoutMs: 30_000,
      batchSize: 10,
    });
  });

  it('accepts shared worker overrides and canonicalizes provider host lists', () => {
    const config = loadClaimActionsCaptureWorkerConfig(
      {
        ...baseEnv,
        EVM_BSC_RPC_URLS: 'https://bsc.example/,https://rpc.example/,https://bsc.example/',
        PROVIDER_ALLOW_HOSTS: 'RPC.EXAMPLE,bsc.example',
        SQD_PROVIDER_ALLOW_HOSTS: 'PORTAL.SQD.DEV',
        CLAIM_CAPTURE_WORKER_OWNER: undefined,
        CAPTURE_WORKER_OWNER: 'shared-worker',
        CLAIM_CAPTURE_WORKER_BATCH_SIZE: '4',
        CAPTURE_WORKER_LEASE_SECONDS: '60',
        CAPTURE_WORKER_ONCE: 'true',
        EVM_BSC_REQUESTS_PER_SECOND: '4.5',
      },
      [],
    );
    expect(config).toMatchObject({
      bscRpcUrls: ['https://bsc.example/', 'https://rpc.example/'],
      providerAllowedHosts: ['bsc.example', 'rpc.example'],
      sqdAllowedHosts: ['portal.sqd.dev'],
      owner: 'shared-worker',
      batchSize: 4,
      leaseSeconds: 60,
      once: true,
      bscRequestsPerSecond: 4.5,
    });
  });

  it('rejects duplicate/unknown arguments and unsafe worker identities', () => {
    expect(() => loadClaimActionsCaptureWorkerConfig(baseEnv, ['--unknown'])).toThrow(
      'Unknown Claim Actions capture argument',
    );
    expect(() => loadClaimActionsCaptureWorkerConfig(baseEnv, ['--once', '--once'])).toThrow(
      '--once may be supplied only once.',
    );
    expect(() =>
      loadClaimActionsCaptureWorkerConfig(
        { ...baseEnv, CLAIM_CAPTURE_WORKER_OWNER: 'worker with spaces' },
        [],
      ),
    ).toThrow('CLAIM_CAPTURE_WORKER_OWNER contains unsupported characters or is too long.');
    expect(() =>
      loadClaimActionsCaptureWorkerConfig({ ...baseEnv, ALLOW_PRIVATE_PROVIDER_URLS: 'yes' }, []),
    ).toThrow('ALLOW_PRIVATE_PROVIDER_URLS must be true or false.');
  });
});
