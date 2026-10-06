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

/** 全图避让金额标签与地址节点；引线连接原资金路径，身份与路径保持独立。 */
export function flowLayout(flows: FlowIdentity[], nodes: FlowPosition[], height = 400) {
  const occupied = nodes.map((n) => ({ x: n.x, y: n.y, width: 140, height: 50 }));
  const result = new Map<
    string,
    ReturnType<typeof flowGeometry> & { anchorX: number; anchorY: number }
  >();
  for (const flow of [...flows].sort((a, b) => a.id.localeCompare(b.id))) {
    const from = nodes.find((n) => n.address === flow.from)!,
      to = nodes.find((n) => n.address === flow.to)!;
    const g = flowGeometry(flow, flows, from, to);
    const self = from.address === to.address;
    const anchorX = self ? g.x : ((from.x + to.x) / 2 + g.x) / 2;
    const anchorY = self ? (from.y - 25) / 4 + (g.y * 3) / 4 : ((from.y + to.y) / 2 + g.y) / 2;
    let position = { x: g.x, y: g.y };
    search: for (const dy of [0, -60, 60, -120, 120, -180, 180]) {
      for (const dx of [0, -150, 150, -300, 300]) {
        const candidate = {
          x: Math.max(78, Math.min(722, anchorX + dx)),
          y: Math.max(32, Math.min(height - 32, anchorY + dy)),
        };
        if (
          occupied.every(
            (b) =>
              Math.abs(b.x - candidate.x) > (b.width + 138) / 2 + 6 ||
              Math.abs(b.y - candidate.y) > (b.height + 50) / 2 + 6,
          )
        ) {
          position = candidate;
          break search;
        }
      }
    }
    occupied.push({ ...position, width: 138, height: 50 });
    result.set(flow.id, { ...g, ...position, anchorX, anchorY });
  }
  return result;
}
