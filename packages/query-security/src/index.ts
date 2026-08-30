import {
  astVisitor,
  parse,
  toSql,
  type Expr,
  type FromStatement,
  type QName,
  type SelectFromStatement,
  type Statement,
} from 'pgsql-ast-parser';

export const QUERY_GUARD_VERSION = 'query-guard-v1.0.0';

export type QuerySecurityErrorCode =
  | 'UNSAFE_POLICY'
  | 'INPUT_SIZE'
  | 'PARSE_FAILED'
  | 'READ_ONLY_SELECT_REQUIRED'
  | 'UNSUPPORTED_QUERY_SHAPE'
  | 'LOCKING_FORBIDDEN'
  | 'RELATION_FORBIDDEN'
  | 'FUNCTION_FORBIDDEN'
  | 'PARAMETER_INVALID'
  | 'COMPLEXITY_LIMIT'
  | 'ROW_LIMIT_REQUIRED'
  | 'OFFSET_LIMIT';

export class QuerySecurityError extends Error {
  public constructor(
    public readonly code: QuerySecurityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuerySecurityError';
  }
}

export interface ReadOnlyQueryPolicyInput {
  allowedRelations: readonly string[];
  allowedFunctions: readonly string[];
  maxSqlBytes?: number;
  maxRelations?: number;
  maxSubqueries?: number;
  maxParameters?: number;
  maxRows?: number;
  maxOffset?: number;
  maxScanBytes?: number;
  timeoutMs?: number;
}

export interface ReadOnlyQueryPolicy {
  version: typeof QUERY_GUARD_VERSION;
  allowedRelations: ReadonlySet<string>;
  allowedFunctions: ReadonlySet<string>;
  maxSqlBytes: number;
  maxRelations: number;
  maxSubqueries: number;
  maxParameters: number;
  maxRows: number;
  maxOffset: number;
  maxScanBytes: number;
  timeoutMs: number;
}

export interface ReadOnlyQueryAdmission {
  guardVersion: typeof QUERY_GUARD_VERSION;
  normalizedSql: string;
  relations: string[];
  functions: string[];
  parameterCount: number;
  rowLimit: number;
  offset: number;
  scanByteLimit: number;
  timeoutMs: number;
  readOnlyTransactionRequired: true;
  fileAccessAllowed: false;
  networkAccessAllowed: false;
}

function canonical(value: string): string {
  return value
    .split('.')
    .map((part) => part.trim().replace(/^"|"$/g, '').toLowerCase())
    .join('.');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new QuerySecurityError('UNSAFE_POLICY', '查询安全上限必须是正安全整数。');
  }
  return selected;
}

export function createReadOnlyQueryPolicy(input: ReadOnlyQueryPolicyInput): ReadOnlyQueryPolicy {
  const allowedRelations = new Set(input.allowedRelations.map(canonical));
  if (
    allowedRelations.size === 0 ||
    [...allowedRelations].some(
      (relation) => !relation.startsWith('curated.') && !relation.startsWith('research.'),
    )
  ) {
    throw new QuerySecurityError(
      'UNSAFE_POLICY',
      '查询关系白名单只能包含 Curated 或 Research 视图。',
    );
  }
  const allowedFunctions = new Set(input.allowedFunctions.map(canonical));
  if ([...allowedFunctions].some((name) => name.length === 0 || name.includes('.'))) {
    throw new QuerySecurityError('UNSAFE_POLICY', '函数白名单只接受无 schema 的确定性函数名。');
  }
  return {
    version: QUERY_GUARD_VERSION,
    allowedRelations,
    allowedFunctions,
    maxSqlBytes: positiveInteger(input.maxSqlBytes, 64 * 1024),
    maxRelations: positiveInteger(input.maxRelations, 16),
    maxSubqueries: positiveInteger(input.maxSubqueries, 8),
    maxParameters: positiveInteger(input.maxParameters, 64),
    maxRows: positiveInteger(input.maxRows, 10_000),
    maxOffset: positiveInteger(input.maxOffset, 100_000),
    maxScanBytes: positiveInteger(input.maxScanBytes, 512 * 1024 * 1024),
    timeoutMs: positiveInteger(input.timeoutMs, 30_000),
  };
}

function qname(value: QName): string {
  if (value.schema === undefined) return canonical(value.name);
  return canonical(`${value.schema}.${value.name}`);
}

function literalInteger(expression: Expr | null | undefined): number | undefined {
  if (expression?.type !== 'integer' || !Number.isSafeInteger(expression.value)) return undefined;
  return expression.value;
}

function rowWindow(
  statement: SelectFromStatement,
  policy: ReadOnlyQueryPolicy,
): { rowLimit: number; offset: number } {
  const rowLimit = literalInteger(statement.limit?.limit);
  if (rowLimit === undefined || rowLimit <= 0 || rowLimit > policy.maxRows) {
    throw new QuerySecurityError(
      'ROW_LIMIT_REQUIRED',
      `查询必须使用不超过 ${policy.maxRows} 的静态正整数 LIMIT。`,
    );
  }
  const offset = statement.limit?.offset === undefined ? 0 : literalInteger(statement.limit.offset);
  if (offset === undefined || offset < 0 || offset > policy.maxOffset) {
    throw new QuerySecurityError('OFFSET_LIMIT', `OFFSET 不得超过 ${policy.maxOffset}。`);
  }
  return { rowLimit, offset };
}

function safeFromStatement(value: FromStatement): void {
  if (value.lateral === true) {
    throw new QuerySecurityError('UNSUPPORTED_QUERY_SHAPE', '禁止 LATERAL 子查询。');
  }
}

export function guardReadOnlyQuery(
  sql: string,
  policy: ReadOnlyQueryPolicy,
): ReadOnlyQueryAdmission {
  if (sql.trim().length === 0 || Buffer.byteLength(sql, 'utf8') > policy.maxSqlBytes) {
    throw new QuerySecurityError('INPUT_SIZE', 'SQL 为空或超过输入大小上限。');
  }
  let statements: Statement[];
  try {
    statements = parse(sql);
  } catch {
    throw new QuerySecurityError('PARSE_FAILED', 'SQL 无法解析为受支持的 PostgreSQL AST。');
  }
  if (statements.length !== 1 || statements[0]?.type !== 'select') {
    throw new QuerySecurityError(
      'READ_ONLY_SELECT_REQUIRED',
      '只允许单条 SELECT；DDL、DML、事务和会话语句均禁止。',
    );
  }
  const statement = statements[0];
  if (statement.for !== undefined || statement.skip !== undefined) {
    throw new QuerySecurityError('LOCKING_FORBIDDEN', 'FOR UPDATE/SHARE 与锁等待选项均禁止。');
  }
  const { rowLimit, offset } = rowWindow(statement, policy);
  const relations = new Set<string>();
  const functions = new Set<string>();
  const parameters = new Set<number>();
  let subqueries = 0;

  const visitor = astVisitor((visitorMap) => ({
    selection: (selection) => {
      subqueries += 1;
      if (selection.for !== undefined || selection.skip !== undefined) {
        throw new QuerySecurityError('LOCKING_FORBIDDEN', '任何层级的锁定 SELECT 均禁止。');
      }
      visitorMap.super().selection(selection);
    },
    tableRef: (table) => {
      relations.add(qname(table));
      visitorMap.super().tableRef(table);
    },
    fromCall: () => {
      throw new QuerySecurityError(
        'FUNCTION_FORBIDDEN',
        '表值函数可能访问文件、网络或系统状态，已禁止。',
      );
    },
    fromStatement: (from) => {
      safeFromStatement(from);
      visitorMap.super().fromStatement(from);
    },
    call: (call) => {
      functions.add(qname(call.function));
      visitorMap.super().call(call);
    },
    cast: () => {
      throw new QuerySecurityError(
        'FUNCTION_FORBIDDEN',
        '类型转换可能调用自定义类型函数，当前安全子集不接受 CAST。',
      );
    },
    constant: (value) => {
      if (value.type === 'constant') {
        throw new QuerySecurityError('FUNCTION_FORBIDDEN', '自定义类型字面量不在确定性查询子集。');
      }
      visitorMap.super().constant(value);
    },
    binary: (binary) => {
      if (binary.opSchema !== undefined) {
        throw new QuerySecurityError(
          'FUNCTION_FORBIDDEN',
          '显式 schema 运算符不在确定性查询子集。',
        );
      }
      visitorMap.super().binary(binary);
    },
    valueKeyword: () => {
      throw new QuerySecurityError(
        'FUNCTION_FORBIDDEN',
        '会话身份或当前时间关键字不满足 point-in-time 可重放要求。',
      );
    },
    parameter: (parameter) => {
      const match = /^\$([1-9]\d*)$/.exec(parameter.name);
      if (match?.[1] === undefined) {
        throw new QuerySecurityError('PARAMETER_INVALID', '只允许 $1 形式的位置参数。');
      }
      parameters.add(Number(match[1]));
      visitorMap.super().parameter(parameter);
    },
  }));
  visitor.statement(statement);

  if (relations.size > policy.maxRelations || subqueries > policy.maxSubqueries) {
    throw new QuerySecurityError('COMPLEXITY_LIMIT', '查询关系数或子查询数超过安全上限。');
  }
  const forbiddenRelation = [...relations].find(
    (relation) => !policy.allowedRelations.has(relation),
  );
  if (forbiddenRelation !== undefined) {
    throw new QuerySecurityError(
      'RELATION_FORBIDDEN',
      `关系 ${forbiddenRelation} 不在 Curated/Research 白名单。`,
    );
  }
  const forbiddenFunction = [...functions].find((name) => !policy.allowedFunctions.has(name));
  if (forbiddenFunction !== undefined) {
    throw new QuerySecurityError(
      'FUNCTION_FORBIDDEN',
      `函数 ${forbiddenFunction} 不在确定性白名单。`,
    );
  }
  const parameterCount = parameters.size === 0 ? 0 : Math.max(...parameters);
  const orderedParameters = [...parameters].sort((left, right) => left - right);
  if (
    parameterCount > policy.maxParameters ||
    orderedParameters.some((value, index) => value !== index + 1)
  ) {
    throw new QuerySecurityError('PARAMETER_INVALID', '位置参数必须从 $1 连续编号且不超过上限。');
  }
  return {
    guardVersion: QUERY_GUARD_VERSION,
    normalizedSql: toSql.statement(statement),
    relations: [...relations].sort(),
    functions: [...functions].sort(),
    parameterCount,
    rowLimit,
    offset,
    scanByteLimit: policy.maxScanBytes,
    timeoutMs: policy.timeoutMs,
    readOnlyTransactionRequired: true,
    fileAccessAllowed: false,
    networkAccessAllowed: false,
  };
}
