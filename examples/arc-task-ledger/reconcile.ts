import { DatabaseSync } from 'node:sqlite';
import { readBundleFile } from './read-bundle.js';
import { pathToFileURL } from 'node:url';
import { replayReportBundle, type ReportBundle } from '@zerotrace/arc-task-ledger';
import { ArcUsdcClient } from './verifier-client.js';
export function reconcile(
  bundle: ReportBundle,
  database: string,
  namespace: string,
  businessReference: string,
) {
  replayReportBundle(bundle);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(namespace) || !/^[A-Za-z0-9_-]{1,120}$/.test(businessReference))
    throw Error('Invalid local accounting namespace/reference');
  const report = bundle.report;
  const evidence = {
    reportId: report.reportId,
    bundleHash: bundle.bundleHash,
    factsHash: report.factsHash,
    transactionUrl: 'https://explorer.arc.io/tx/' + report.transactionHash,
  };
  if (report.evaluation?.outcome !== 'MATCHED')
    return {
      state: 'NO_ALLOCATION',
      outcome: report.evaluation?.outcome ?? 'INCONCLUSIVE',
      reportId: report.reportId,
      evidence,
    };
  const db = new DatabaseSync(database);
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS reconciliations(namespace TEXT NOT NULL, movement_id TEXT NOT NULL, business_reference TEXT NOT NULL, report_id TEXT NOT NULL, amount_atomic18 TEXT NOT NULL, PRIMARY KEY(namespace,movement_id))',
    );
    db.exec('BEGIN IMMEDIATE');
    let inserted = 0;
    for (const id of report.evaluation.selectedMovementIds) {
      const m = report.facts?.movements.find((x) => x.id === id);
      if (!m) throw Error('Selected movement missing');
      const old = db
        .prepare('SELECT * FROM reconciliations WHERE namespace=? AND movement_id=?')
        .get(namespace, id);
      if (old) {
        if (old.business_reference !== businessReference || old.amount_atomic18 !== m.atomic)
          throw Error('LOCAL_ALLOCATION_CONFLICT');
        continue;
      }
      db.prepare('INSERT INTO reconciliations VALUES(?,?,?,?,?)').run(
        namespace,
        id,
        businessReference,
        report.reportId,
        m.atomic,
      );
      inserted++;
    }
    db.exec('COMMIT');
    return {
      state: inserted ? 'ALLOCATED_LOCALLY' : 'IDEMPOTENT_LOCAL_ALLOCATION',
      inserted,
      reportId: report.reportId,
      scope: 'THIS_ACCOUNTING_NAMESPACE_ONLY',
      evidence,
      accountingRows: report.evaluation.selectedMovementIds.map((id) => ({
        namespace,
        businessReference,
        movementId: id,
        amountAtomic18: report.facts!.movements.find((m) => m.id === id)!.atomic,
        ...evidence,
      })),
      mainnetAuthenticity: 'NOT_VERIFIED_OFFLINE',
    };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
}
async function main() {
  const [source, database, namespace, businessReference] = process.argv.slice(2);
  if (!source || !database || !namespace || !businessReference)
    throw Error(
      'Usage: reconcile.ts bundle.json|https://API_ORIGIN#REPORT_ID local.sqlite namespace business_reference',
    );
  let bundle: ReportBundle;
  if (source.startsWith('https://') || source.startsWith('http://')) {
    const u = new URL(source);
    const id = u.hash.slice(1);
    u.hash = '';
    bundle = await new ArcUsdcClient(u.href).bundle(id);
  } else {
    bundle = (await readBundleFile(source)) as ReportBundle;
  }
  console.log(JSON.stringify(reconcile(bundle, database, namespace, businessReference)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(
      JSON.stringify({
        state: 'RECONCILIATION_REJECTED',
        code:
          e.code ?? (e.message === 'LOCAL_ALLOCATION_CONFLICT' ? e.message : 'INPUT_OR_API_ERROR'),
      }),
    );
    process.exitCode = 1;
  });
