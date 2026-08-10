import { evaluateEntityStructuralGolden } from './golden.js';

const report = evaluateEntityStructuralGolden();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== 'PASS') process.exitCode = 1;
