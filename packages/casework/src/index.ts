import { createHash } from 'node:crypto';

import {
  buildForensicFinding,
  canonicalJson,
  contentAddressedId,
  hashPayload,
} from '@zerotrace/evidence';
import {
  AnalystDecisionSchema,
  CaseExportManifestSchema,
  type AnalystDecision,
  type CaseExportManifest,
  type ForensicFinding,
} from '@zerotrace/schemas';

export const CASEWORK_MODEL_VERSION = 'casework-v1.0.0';

export function recordAnalystDecision(
  input: Omit<AnalystDecision, 'id' | 'nextStateHash'> & { nextState?: unknown },
): AnalystDecision {
  const nextStateHash = hashPayload(input.nextState ?? { disposition: input.disposition });
  const { nextState: _ignored, ...rest } = { ...input, nextStateHash };
  void _ignored;
  const id = contentAddressedId('ads', rest);
  return AnalystDecisionSchema.parse({ ...rest, id, nextStateHash });
}

export interface CaseExportInput {
  investigationId: string;
  findings: readonly ForensicFinding[];
  limitations: readonly string[];
  createdAt: string;
}

export interface CaseExportFiles {
  'case.json': string;
  'summary.zh-CN.html': string;
  'findings.jsonl': string;
  'evidence.jsonl': string;
  'limitations.md': string;
  'replay.ps1': string;
  'hashes.sha256': string;
  manifest: CaseExportManifest;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function exportCasePackage(input: CaseExportInput): CaseExportFiles {
  const caseId = contentAddressedId('cse', {
    investigationId: input.investigationId,
    createdAt: input.createdAt,
  });
  const caseJson = canonicalJson({
    caseId,
    investigationId: input.investigationId,
    findingIds: input.findings.map((item) => item.id),
    evidenceIds: [
      ...new Set(input.findings.flatMap((item) => item.evidenceFor.map((ref) => ref.id))),
    ].sort(),
    createdAt: input.createdAt,
  });
  const findingsJsonl = input.findings.map((item) => canonicalJson(item)).join('\n');
  const evidenceJsonl = input.findings
    .flatMap((finding) =>
      finding.evidenceFor.map((ref) =>
        canonicalJson({
          id: ref.id,
          findingId: finding.id,
          resultHash: finding.resultHash,
          snapshot: finding.snapshot,
          familyKind: ref.familyKind,
          summary: ref.summary,
        }),
      ),
    )
    .join('\n');
  const limitations = `# 限制\n\n${input.limitations.map((item) => `- ${item}`).join('\n')}\n`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>案件 ${caseId}</title></head><body><h1>链上盘面结构取证案件</h1><p>调查 ${input.investigationId}</p><p>发现 ${input.findings.length} 项，均绑定快照与证据。</p></body></html>`;
  const replay = `param([string]$InvestigationId = '${input.investigationId}', [string]$ApiBase = 'http://127.0.0.1:8080')
$uri = "$ApiBase/api/v2/investigations/$InvestigationId/replay"
$response = Invoke-RestMethod -Method POST -Uri $uri
if ($null -eq $response.recomputedResultHash -or $response.match -ne $true) {
  throw "Replay hash mismatch for $InvestigationId"
}
Write-Host "回放调查 $InvestigationId 只读完成，resultHash=$($response.recomputedResultHash)"
`;
  const files = {
    'case.json': caseJson,
    'summary.zh-CN.html': html,
    'findings.jsonl': findingsJsonl,
    'evidence.jsonl': evidenceJsonl,
    'limitations.md': limitations,
    'replay.ps1': replay,
  };
  const hashes = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .join('\n');
  const manifest = CaseExportManifestSchema.parse({
    caseId,
    investigationId: input.investigationId,
    createdAt: input.createdAt,
    files: [
      ...Object.keys(files).map((name) => ({
        name,
        sha256: sha256(files[name as keyof typeof files]),
      })),
      { name: 'hashes.sha256', sha256: sha256(`${hashes}\n`) },
    ],
    limitations: [...input.limitations],
  });
  return {
    ...files,
    'hashes.sha256': `${hashes}\n`,
    manifest,
  };
}

export function assertFindingHasSnapshot(finding: ForensicFinding): void {
  buildForensicFinding({ ...finding, id: finding.id });
  if (finding.snapshot === undefined) {
    throw new Error('Finding is missing a ledger snapshot.');
  }
}
