import { Pool, type PoolClient } from 'pg';

import { hashPayload } from '@zerotrace/evidence';
import { EntityInvestigationGraphReportSchema } from '@zerotrace/schemas';

import type { StoredEntityInvestigationGraph } from './entity-investigation-graphs.js';

const GRAPH_NAME = 'zerotrace_investigation';
const MIGRATION_VERSION = '001_investigation_graph_projection';
const CHUNK_SIZE = 25;

export interface AgeInvestigationGraphProjectionOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface AgePool {
  connect(): Promise<Pick<PoolClient, 'query' | 'release'>>;
  end(): Promise<void>;
}

export type AgeInvestigationGraphProjectionErrorCode =
  | 'AGE_PROJECTION_INVALID'
  | 'AGE_PROJECTION_CONFLICT'
  | 'AGE_PROJECTION_UNAVAILABLE'
  | 'AGE_PROJECTION_NOT_INITIALIZED';

export class AgeInvestigationGraphProjectionError extends Error {
  readonly code: AgeInvestigationGraphProjectionErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AgeInvestigationGraphProjectionErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AgeInvestigationGraphProjectionError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface AgeInvestigationGraphProjectionResult {
  status: 'PROJECTED' | 'REPLAYED';
  backend: 'APACHE_AGE';
  durable: true;
  graphName: typeof GRAPH_NAME;
  graphReportId: string;
  resultHash: string;
  nodeCount: number;
  edgeCount: number;
  projectedAt: string;
}

function createPool(options: AgeInvestigationGraphProjectionOptions): AgePool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-age-investigation-graph',
  });
  pool.on('error', () => undefined);
  return pool;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function dollarQuoted(value: string): string {
  let suffix = hashPayload(value).slice(0, 16);
  let delimiter = `$zt_${suffix}$`;
  while (value.includes(delimiter)) {
    suffix += '0';
    delimiter = `$zt_${suffix}$`;
  }
  return `${delimiter}${value}${delimiter}`;
}

function cypherMap(value: Readonly<Record<string, unknown>>): string {
  return `{${Object.entries(value)
    .map(([key, item]) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        throw new AgeInvestigationGraphProjectionError(
          'AGE_PROJECTION_INVALID',
          'Apache AGE projection property name is invalid.',
        );
      }
      return `${key}: ${JSON.stringify(item)}`;
    })
    .join(', ')}}`;
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK_SIZE) {
    result.push(values.slice(index, index + CHUNK_SIZE));
  }
  return result;
}

function knowledgeProperties(
  prefix: string,
  value: { state: string; value?: unknown; reason?: string },
): Record<string, unknown> {
  return {
    [`${prefix}State`]: value.state,
    ...(value.state === 'known' ? { [`${prefix}Value`]: value.value } : {}),
    ...(value.state === 'known' ? {} : { [`${prefix}Reason`]: value.reason }),
  };
}

async function initializeSession(client: Pick<PoolClient, 'query'>): Promise<void> {
  await client.query("LOAD 'age'");
  await client.query('SET LOCAL search_path = ag_catalog, "$user", public');
}

async function assertInitialized(client: Pick<PoolClient, 'query'>): Promise<void> {
  const result = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') AS extension_ready,
       EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1) AS graph_ready,
       to_regclass('public.zerotrace_graph_projection_registry')::text AS registry_table,
       EXISTS (
         SELECT 1 FROM public.zerotrace_graph_projection_migrations WHERE version = $2
       ) AS migration_applied`,
    [GRAPH_NAME, MIGRATION_VERSION],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (
    row?.extension_ready !== true ||
    row.graph_ready !== true ||
    row.registry_table !== 'zerotrace_graph_projection_registry' ||
    row.migration_applied !== true
  ) {
    throw new AgeInvestigationGraphProjectionError(
      'AGE_PROJECTION_NOT_INITIALIZED',
      'Apache AGE investigation graph schema is not initialized.',
    );
  }
}

async function cypher(client: Pick<PoolClient, 'query'>, query: string): Promise<void> {
  await client.query(
    `SELECT * FROM cypher(${sqlString(GRAPH_NAME)}, ${dollarQuoted(query)}) AS (value agtype)`,
  );
}

async function projectedCounts(
  client: Pick<PoolClient, 'query'>,
  graphReportId: string,
  resultHash: string,
): Promise<{ nodeCount: number; edgeCount: number }> {
  const condition = `graphReportId: ${JSON.stringify(graphReportId)}, resultHash: ${JSON.stringify(resultHash)}`;
  const nodeResult = await client.query(
    `SELECT * FROM cypher(${sqlString(GRAPH_NAME)}, ${dollarQuoted(
      `MATCH (node:Subject {${condition}}) RETURN count(node)`,
    )}) AS (count agtype)`,
  );
  const edgeResult = await client.query(
    `SELECT * FROM cypher(${sqlString(GRAPH_NAME)}, ${dollarQuoted(
      `MATCH (:Subject)-[edge {${condition}}]->(:Subject) RETURN count(edge)`,
    )}) AS (count agtype)`,
  );
  const nodeCount = Number(nodeResult.rows[0]?.count);
  const edgeCount = Number(edgeResult.rows[0]?.count);
  if (!Number.isSafeInteger(nodeCount) || !Number.isSafeInteger(edgeCount)) {
    throw new AgeInvestigationGraphProjectionError(
      'AGE_PROJECTION_CONFLICT',
      'Apache AGE projection counts are invalid.',
    );
  }
  return { nodeCount, edgeCount };
}

function storedTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(timestamp.getTime())) {
    throw new AgeInvestigationGraphProjectionError(
      'AGE_PROJECTION_CONFLICT',
      'Apache AGE registry timestamp is invalid.',
    );
  }
  return timestamp.toISOString();
}

function rowResult(row: Record<string, unknown>): AgeInvestigationGraphProjectionResult {
  const graphReportId = row.graph_report_id;
  const resultHash = row.result_hash;
  const nodeCount = Number(row.node_count);
  const edgeCount = Number(row.edge_count);
  if (
    typeof graphReportId !== 'string' ||
    typeof resultHash !== 'string' ||
    !Number.isSafeInteger(nodeCount) ||
    !Number.isSafeInteger(edgeCount)
  ) {
    throw new AgeInvestigationGraphProjectionError(
      'AGE_PROJECTION_CONFLICT',
      'Apache AGE registry row is invalid.',
    );
  }
  return {
    status: 'PROJECTED',
    backend: 'APACHE_AGE',
    durable: true,
    graphName: GRAPH_NAME,
    graphReportId,
    resultHash,
    nodeCount,
    edgeCount,
    projectedAt: storedTimestamp(row.projected_at),
  };
}

export class AgeInvestigationGraphProjectionRepository {
  readonly #pool: AgePool;

  constructor(options: AgeInvestigationGraphProjectionOptions | { pool: AgePool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: AgePool): AgeInvestigationGraphProjectionRepository {
    return new AgeInvestigationGraphProjectionRepository({ pool });
  }

  async project(
    stored: StoredEntityInvestigationGraph,
  ): Promise<AgeInvestigationGraphProjectionResult> {
    const parsed = EntityInvestigationGraphReportSchema.safeParse(stored.report);
    if (!parsed.success) {
      throw new AgeInvestigationGraphProjectionError(
        'AGE_PROJECTION_INVALID',
        'Entity investigation graph report is invalid.',
        { cause: parsed.error },
      );
    }
    const resultHash = hashPayload(parsed.data);
    const expectedId = `eig_${hashPayload({ schema: 'zerotrace-entity-investigation-graph-report-v1', resultHash }).slice(0, 24)}`;
    if (stored.resultHash !== resultHash || stored.id !== expectedId) {
      throw new AgeInvestigationGraphProjectionError(
        'AGE_PROJECTION_INVALID',
        'Entity investigation graph stored identity is invalid.',
      );
    }
    let client: Pick<PoolClient, 'query' | 'release'>;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new AgeInvestigationGraphProjectionError(
        'AGE_PROJECTION_UNAVAILABLE',
        'Apache AGE is unavailable.',
        { retryable: true, cause: error },
      );
    }
    try {
      await client.query('BEGIN');
      await initializeSession(client);
      await assertInitialized(client);
      const existing = await client.query(
        `SELECT graph_report_id, result_hash, node_count, edge_count, projected_at
         FROM public.zerotrace_graph_projection_registry
         WHERE graph_report_id = $1`,
        [stored.id],
      );
      if (existing.rows[0] !== undefined) {
        const replayed = rowResult(existing.rows[0] as Record<string, unknown>);
        const actual = await projectedCounts(client, stored.id, stored.resultHash);
        if (
          replayed.resultHash !== stored.resultHash ||
          replayed.nodeCount !== stored.report.graph.nodes.length ||
          replayed.edgeCount !== stored.report.graph.edges.length ||
          actual.nodeCount !== replayed.nodeCount ||
          actual.edgeCount !== replayed.edgeCount
        ) {
          throw new AgeInvestigationGraphProjectionError(
            'AGE_PROJECTION_CONFLICT',
            'Apache AGE projection registry conflicts with the immutable graph report.',
          );
        }
        await client.query('COMMIT');
        return { ...replayed, status: 'REPLAYED' };
      }

      for (const group of chunks(stored.report.graph.nodes)) {
        const clauses = group.map((node, index) => {
          const properties = {
            projectionKey: `${stored.id}:${node.id}`,
            graphReportId: stored.id,
            resultHash: stored.resultHash,
            nodeId: node.id,
            ledger: stored.ledger,
            chainId: stored.chainId,
            subjectId: node.subjectId,
            ...knowledgeProperties('subjectType', node.subjectType),
            ...knowledgeProperties('serviceInfrastructure', node.serviceInfrastructure),
            terminalEvidenceIds: node.terminalEvidenceIds,
          };
          return `MERGE (n${index}:Subject ${cypherMap(properties)})`;
        });
        await cypher(client, `${clauses.join('\n')}\nRETURN 1`);
      }
      for (const group of chunks(stored.report.graph.edges)) {
        const clauses = group.flatMap((edge, index) => {
          const properties = {
            projectionKey: `${stored.id}:${edge.id}`,
            graphReportId: stored.id,
            resultHash: stored.resultHash,
            edgeId: edge.id,
            classification: edge.classification,
            timelineId: edge.timelineId,
            terminalEvidenceId: edge.terminalEvidenceId,
            validFromPosition: edge.validFromPosition,
            validToPosition: edge.validToPosition,
            automaticOwnershipPropagationAllowed: false,
            ...knowledgeProperties('sameControllerProbability', edge.sameControllerProbability),
            ...knowledgeProperties('coordinationProbability', edge.coordinationProbability),
            ...knowledgeProperties('independenceProbability', edge.independenceProbability),
          };
          return [
            `MATCH (a${index}:Subject {projectionKey: ${JSON.stringify(`${stored.id}:${edge.sourceNodeId}`)}})`,
            `MATCH (b${index}:Subject {projectionKey: ${JSON.stringify(`${stored.id}:${edge.targetNodeId}`)}})`,
            `MERGE (a${index})-[e${index}:${edge.relation} ${cypherMap(properties)}]->(b${index})`,
          ];
        });
        await cypher(client, `${clauses.join('\n')}\nRETURN 1`);
      }
      const actual = await projectedCounts(client, stored.id, stored.resultHash);
      if (
        actual.nodeCount !== stored.report.graph.nodes.length ||
        actual.edgeCount !== stored.report.graph.edges.length
      ) {
        throw new AgeInvestigationGraphProjectionError(
          'AGE_PROJECTION_CONFLICT',
          'Apache AGE projection counts do not match the immutable graph report.',
        );
      }
      const inserted = await client.query(
        `INSERT INTO public.zerotrace_graph_projection_registry (
           graph_report_id, result_hash, node_count, edge_count
         ) VALUES ($1, $2, $3, $4)
         RETURNING graph_report_id, result_hash, node_count, edge_count, projected_at`,
        [
          stored.id,
          stored.resultHash,
          stored.report.graph.nodes.length,
          stored.report.graph.edges.length,
        ],
      );
      const row = inserted.rows[0] as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new AgeInvestigationGraphProjectionError(
          'AGE_PROJECTION_CONFLICT',
          'Apache AGE projection registry insert returned no row.',
        );
      }
      const result = rowResult(row);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the projection failure.
      }
      if (error instanceof AgeInvestigationGraphProjectionError) throw error;
      throw new AgeInvestigationGraphProjectionError(
        'AGE_PROJECTION_UNAVAILABLE',
        'Apache AGE investigation graph projection failed.',
        { retryable: true, cause: error },
      );
    } finally {
      client.release();
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'APACHE_AGE';
    durable: true;
    checkedAt: string;
    graphName: typeof GRAPH_NAME;
    errorCode?: 'AGE_PROJECTION_UNAVAILABLE' | 'AGE_PROJECTION_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    let client: Pick<PoolClient, 'query' | 'release'> | undefined;
    try {
      client = await this.#pool.connect();
      await client.query('BEGIN');
      await initializeSession(client);
      await assertInitialized(client);
      await client.query('ROLLBACK');
      return {
        status: 'UP',
        backend: 'APACHE_AGE',
        durable: true,
        checkedAt,
        graphName: GRAPH_NAME,
      };
    } catch (error) {
      if (client !== undefined) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Health already reports the primary error.
        }
      }
      return {
        status: 'DOWN',
        backend: 'APACHE_AGE',
        durable: true,
        checkedAt,
        graphName: GRAPH_NAME,
        errorCode:
          error instanceof AgeInvestigationGraphProjectionError &&
          error.code === 'AGE_PROJECTION_NOT_INITIALIZED'
            ? 'AGE_PROJECTION_NOT_INITIALIZED'
            : 'AGE_PROJECTION_UNAVAILABLE',
      };
    } finally {
      client?.release();
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
