import {
  AgeInvestigationGraphProjectionRepository,
  PostgresEntityInvestigationGraphRepository,
} from '@zerotrace/storage';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the real Apache AGE smoke.`);
  }
  return value;
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function main(): Promise<void> {
  const postgresUrl = requiredEnvironment('TEST_POSTGRES_URL');
  const ageUrl = requiredEnvironment('TEST_AGE_URL');
  const ledger = argument('--ledger', 'EVM');
  const chainId = argument('--chain-id', 'eip155:56');
  if (ledger !== 'EVM' && ledger !== 'BITCOIN' && ledger !== 'SOLANA') {
    throw new Error('--ledger must be EVM, BITCOIN, or SOLANA.');
  }

  const postgres = new PostgresEntityInvestigationGraphRepository({
    connectionString: postgresUrl,
    maxConnections: 1,
  });
  const age = new AgeInvestigationGraphProjectionRepository({
    connectionString: ageUrl,
    maxConnections: 1,
  });

  try {
    const health = await age.health();
    if (health.status !== 'UP') throw new Error(`Apache AGE is not healthy: ${health.errorCode}`);
    const stored = await postgres.latest({ ledger, chainId });
    if (stored === undefined) {
      throw new Error(`No durable investigation graph exists for ${ledger}/${chainId}.`);
    }

    const first = await age.project(stored);
    const second = await age.project(stored);
    if (
      first.resultHash !== second.resultHash ||
      second.status !== 'REPLAYED' ||
      first.nodeCount !== second.nodeCount ||
      first.edgeCount !== second.edgeCount
    ) {
      throw new Error('Apache AGE projection replay was not deterministic.');
    }

    console.log(
      JSON.stringify(
        {
          event: 'age_investigation_graph_live_smoke_complete',
          ledger,
          chainId,
          sourceReportId: stored.id,
          health,
          first,
          second,
          replaySameHash: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await age.close();
    await postgres.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
