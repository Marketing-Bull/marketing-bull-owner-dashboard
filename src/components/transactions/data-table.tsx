import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import styles from "./transaction-ledger.module.css";

export type LedgerColumn<T, TSort extends string> = {
  id: string;
  label: string;
  sort?: TSort;
  align?: "left" | "right";
  className?: string;
  render: (row: T) => React.ReactNode;
};

export function DataTable<T, TSort extends string>({
  rows,
  columns,
  rowKey,
  sort,
  direction,
  onSort,
  renderMobile
}: {
  rows: T[];
  columns: LedgerColumn<T, TSort>[];
  rowKey: (row: T) => string;
  sort: TSort;
  direction: "asc" | "desc";
  onSort: (sort: TSort) => void;
  renderMobile: (row: T) => React.ReactNode;
}) {
  return (
    <>
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} className={column.align === "right" ? styles.alignRight : undefined}>
                  {column.sort ? (
                    <button type="button" className={styles.sortButton} onClick={() => onSort(column.sort!)}>
                      {column.label}
                      {sort === column.sort
                        ? direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                        : <ChevronsUpDown size={12} />}
                    </button>
                  ) : column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={[column.align === "right" ? styles.alignRight : "", column.className ?? ""].filter(Boolean).join(" ")}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.mobileRows}>{rows.map((row) => <div key={rowKey(row)}>{renderMobile(row)}</div>)}</div>
    </>
  );
}
