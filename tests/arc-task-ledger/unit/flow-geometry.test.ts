import { it, expect } from 'vitest';
import { flowGeometry } from '../../../apps/arc-task-ledger-web/src/flow-geometry.js';
it('并行、反向与自环资金边独立可选，输入顺序不改变路由', () => {
  const flows = [
    { id: '1', from: 'a', to: 'b' },
    { id: '2', from: 'a', to: 'b' },
    { id: '3', from: 'b', to: 'a' },
    { id: '4', from: 'a', to: 'a' },
    { id: '5', from: 'a', to: 'a' },
  ];
  const a = { address: 'a', x: 150, y: 180 },
    b = { address: 'b', x: 600, y: 180 };
  const geometries = flows.map((f) =>
    flowGeometry(f, flows, f.from === 'a' ? a : b, f.to === 'a' ? a : b),
  );
  expect(new Set(geometries.map((g) => g.path)).size).toBe(5);
  for (let i = 0; i < flows.length; i++)
    expect(
      flowGeometry(
        flows[i]!,
        [...flows].reverse(),
        flows[i]!.from === 'a' ? a : b,
        flows[i]!.to === 'a' ? a : b,
      ),
    ).toEqual(geometries[i]);
  expect(geometries[3]!.y).toBeGreaterThan(0);
});
