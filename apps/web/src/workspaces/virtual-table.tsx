import { useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';

const ROW_HEIGHT = 32;
const OVERSCAN = 8;

export function VirtualTable({
  rows,
  columns,
  empty,
}: {
  rows: readonly Record<string, ReactNode>[];
  columns: readonly { key: string; header: string }[];
  empty: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setViewportHeight(event.currentTarget.clientHeight);
  };

  const windowed = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(rows.length, start + visible);
    return { start, end, offsetY: start * ROW_HEIGHT };
  }, [rows.length, scrollTop, viewportHeight]);

  if (rows.length === 0) return <p>{empty}</p>;
  return (
    <div
      className="virtual-table"
      role="region"
      aria-label={columns.map((item) => item.header).join('、')}
      ref={viewportRef}
      onScroll={onScroll}
      style={{ maxHeight: 480, overflow: 'auto' }}
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        <table style={{ transform: `translateY(${windowed.offsetY}px)` }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(windowed.start, windowed.end).map((row, index) => (
              <tr key={String(row.id ?? windowed.start + index)} style={{ height: ROW_HEIGHT }}>
                {columns.map((column) => (
                  <td key={column.key}>{row[column.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        共 {rows.length} 行，当前渲染 {windowed.end - windowed.start}{' '}
        行窗口；其余行保留在后端游标，不截断为 200。
      </p>
    </div>
  );
}
