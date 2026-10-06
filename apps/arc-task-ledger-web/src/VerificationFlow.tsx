import { flowLayout } from './flow-geometry.js';
import {
  displayUsdc,
  type UsdcMovement,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';
export function VerificationFlow({
  movements,
  selected,
  onSelect,
  lang,
}: {
  movements: UsdcMovement[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
  lang: 'zh' | 'en';
}) {
  const addresses = [...new Set(movements.flatMap((m) => [m.from, m.to]))];
  if (!movements.length) return null;
  if (addresses.length > 8 || movements.length > 16)
    return (
      <p>
        {lang === 'zh'
          ? '复杂资金路径请逐条查看下方资金表与原件。'
          : 'Inspect the movement list and raw evidence for this complex path.'}
      </p>
    );
  const nodes = addresses.map((address, i) => ({
    address,
    x: addresses.length === 1 ? 400 : 400 + Math.cos((i / addresses.length) * Math.PI * 2) * 265,
    y: 200 + Math.sin((i / addresses.length) * Math.PI * 2) * 95,
  }));
  const layout = flowLayout(movements, nodes);
  return (
    <svg
      className="verification-flow"
      viewBox="0 0 800 400"
      role="group"
      aria-label={lang === 'zh' ? '规范资金边与证据联动' : 'Canonical movement and evidence links'}
    >
      <defs>
        <marker
          id="verification-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {movements.map((m) => {
        const g = layout.get(m.id)!;
        return (
          <g
            key={m.id}
            role="button"
            tabIndex={0}
            data-movement-id={m.id}
            aria-label={`${displayUsdc(m.atomic)} USDC ${m.from} → ${m.to} ${m.id}`}
            aria-pressed={selected === m.id}
            className={selected === m.id ? 'selected' : ''}
            onClick={() => onSelect(m.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(m.id);
              }
            }}
          >
            <title>
              {m.id} · {m.kind}
            </title>
            <path className="movement-line" d={g.path} markerEnd="url(#verification-arrow)" />
            <line
              x1={g.anchorX}
              y1={g.anchorY}
              x2={g.x}
              y2={g.y}
              stroke="#668a26"
              strokeDasharray="3 3"
            />
            <rect x={g.x - 69} y={g.y - 15} width="138" height="30" />
            <text x={g.x} y={g.y + 4} textAnchor="middle">
              {displayUsdc(m.atomic).length > 16
                ? displayUsdc(m.atomic).slice(0, 12) + '…'
                : displayUsdc(m.atomic)}{' '}
              USDC
            </text>
          </g>
        );
      })}
      {nodes.map((n) => (
        <g key={n.address}>
          <rect x={n.x - 70} y={n.y - 25} width="140" height="50" />
          <title>{n.address}</title>
          <text x={n.x} y={n.y + 4} textAnchor="middle">
            {n.address.slice(0, 8)}…{n.address.slice(-6)}
          </text>
        </g>
      ))}
    </svg>
  );
}
