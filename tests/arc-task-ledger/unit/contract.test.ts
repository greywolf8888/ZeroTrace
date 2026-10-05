import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { it, expect } from 'vitest';
import {
  publicDetail,
  publicCoverage,
  publicRow,
} from '../../../apps/arc-task-ledger-api/src/contract.js';
import { known, unknown } from '../../../packages/arc-task-ledger/src/types.js';
import { run, snapshot, meta } from '../fixtures/helpers.js';
import { rawEvidence } from '../../../packages/arc-task-ledger/src/protocol.js';
import { hashPayload } from '../../../packages/evidence/src/hash.js';
it('原始响应后续变化不得改变已捕获观察', () => {
  const raw = [{ answer: 'first' }];
  const observation = rawEvidence(raw, snapshot, 'public-dns:https', '测试不可变观察');
  raw.push({ answer: 'later' });
  expect(hashPayload(observation.raw)).toBe(observation.payloadHash);
  expect(observation.raw).toEqual([{ answer: 'first' }]);
});
const spec = JSON.parse(readFileSync('docs/arc-task-ledger/openapi.json', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => !Number.isNaN(Date.parse(value)),
});
function validate(name: string, value: unknown) {
  const check = ajv.compile({ components: spec.components, $ref: `#/components/schemas/${name}` });
  expect(check(value), JSON.stringify(check.errors)).toBe(true);
}
it('三个 API 数据结构符合冻结 OpenAPI 契约', () => {
  const r = run();
  const d = r.jobs[0]!;
  d.evidence = [rawEvidence(meta(), snapshot, 'test-only', '测试')];
  const detail = publicDetail(d);
  validate('JobDetail', { ...detail, nextTimelineCursor: null });
  validate('JobDetail', { ...detail, nextTimelineCursor: null, evidenceRequest: null });
  validate('JobDetail', {
    ...detail,
    nextTimelineCursor: null,
    evidenceRequest: {
      id: 'req_test',
      jobId: '8',
      from: '1',
      to: '2',
      head: '0',
      status: 'PENDING',
      ruleVersion: 'atl-v1.2.0',
      snapshotRunId: 'test_run_a',
    },
  });
  validate('JobsPage', {
    snapshotRunId: r.id,
    items: r.jobs.map((j) => publicRow(j.job)),
    nextCursor: null,
    coverage: publicCoverage(r.coverage),
  });
  validate('CoverageStatus', {
    network: 'arc-mainnet',
    adapter: d.job.adapter,
    lastSuccessfulSync: null,
    stateHead: unknown('无快照'),
    historyHead: known('0'),
    coverage: publicCoverage(r.coverage),
    gaps: [{ reason: '历史不足' }],
  });
});
it('known false、known 0、unknown、unavailable 区分', () => {
  expect(known(false)).toEqual({ state: 'known', value: false, evidenceIds: [] });
  expect(known('0')).not.toEqual(unknown('无数据'));
  validate('Knowledge', known(false));
  validate('Knowledge', known('0'));
  validate('Knowledge', unknown('无数据'));
  validate('Knowledge', { state: 'unavailable', reason: '数据库不可用' });
});
