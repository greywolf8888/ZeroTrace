export interface FlowPosition {
  address: string;
  x: number;
  y: number;
}
export interface FlowIdentity {
  id: string;
  from: string;
  to: string;
}
/** 按无向端点分组后稳定编号，双向边也使用同一法线；不会把同额多笔合并。 */
export function flowGeometry(
  flow: FlowIdentity,
  flows: FlowIdentity[],
  from: FlowPosition,
  to: FlowPosition,
) {
  const peers = flows
    .filter((f) => [f.from, f.to].sort().join(':') === [flow.from, flow.to].sort().join(':'))
    .sort((a, b) => a.id.localeCompare(b.id));
  const ordinal = peers.findIndex((f) => f.id === flow.id);
  if (from.address === to.address) {
    const spread = 42 + ordinal * 14;
    const y = Math.max(28, from.y - 65 - ordinal * 12),
      x = from.x + spread;
    return {
      path: `M ${from.x + 35} ${from.y - 25} C ${x + 35} ${y} ${from.x - 35} ${y} ${from.x - 35} ${from.y - 25}`,
      x: from.x,
      y,
    };
  }
  const dx = to.x - from.x,
    dy = to.y - from.y,
    length = Math.hypot(dx, dy) || 1;
  const direction = from.address < to.address ? 1 : -1;
  const offset = (ordinal - (peers.length - 1) / 2) * 82 + (peers.length === 1 ? 35 : 0);
  const x = (from.x + to.x) / 2 - ((direction * dy) / length) * offset,
    y = (from.y + to.y) / 2 + ((direction * dx) / length) * offset;
  const inset = Math.min(70 / Math.abs(dx || 1), 25 / Math.abs(dy || 1), 0.35);
  return {
    path: `M ${from.x + dx * inset} ${from.y + dy * inset} Q ${x} ${y} ${to.x - dx * inset} ${to.y - dy * inset}`,
    x,
    y,
  };
}
