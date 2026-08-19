import type { ReactNode } from 'react';

export const TABLE_ROW_CAP = 200;

export function VirtualTable({
  rows,
  columns,
  empty,
}: {
  rows: readonly Record<string, ReactNode>[];
  columns: readonly { key: string; header: string }[];
  empty: string;
}) {
  const visible = rows.slice(0, TABLE_ROW_CAP);
  const truncated = rows.length > TABLE_ROW_CAP;
  if (rows.length === 0) return <p>{empty}</p>;
  return (
    <div className="virtual-table" role="region" aria-label={columns.map((item) => item.header).join('、')}>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated ? (
        <p>
          仅渲染前 {TABLE_ROW_CAP} 行，其余 {rows.length - TABLE_ROW_CAP} 行由后端聚合，避免一次装入全部地址。
        </p>
      ) : null}
    </div>
  );
}
