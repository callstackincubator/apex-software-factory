import type { ReactNode } from "react";

/** One column: its header, and what each row shows in it. */
export interface Column<T> {
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** A number or a duration: mono, and right-aligned where the table has columns. */
  readonly numeric?: boolean;
  /** Mono, for what people copy or compare. */
  readonly mono?: boolean;
}

/**
 * Rows as a table. Each cell carries its column's header as `data-label`, so under 768px a row
 * stacks into labelled lines (a `wide` table, of six columns or more, stacks below 1100px).
 */
export function DataTable<T>(props: {
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly rowId: (row: T) => string;
  readonly empty: string;
  readonly wide?: boolean;
  readonly caption?: string;
}) {
  const { caption, columns, empty, rowId, rows, wide = false } = props;
  if (rows.length === 0) return <p className="muted empty">{empty}</p>;
  return (
    <table className={wide ? "table table-wide" : "table"}>
      {caption === undefined ? null : <caption className="visually-hidden">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.header} scope="col" className={column.numeric ? "num" : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowId(row)}>
            {columns.map((column) => (
              <td
                key={column.header}
                data-label={column.header}
                className={column.numeric ? "num" : column.mono ? "mono" : undefined}
              >
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
