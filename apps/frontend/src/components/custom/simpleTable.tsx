export interface Column<T> {
  header: string;
  // If provided, use this function to render custom JSX for the td
  render?: (row: T) => React.ReactNode;
  // Fallback key to extract the raw string/number value from the row object
  accessor?: keyof T;
}
interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
}
export const SimpleTable = <T,>({ columns, data }: TableProps<T>) => {
  return (
    <div className="overflow-hidden border rounded-lg bg-card border-border">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.header}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((v, rowIndex) => {
              return (
                <tr
                  key={rowIndex}
                  className="transition-colors hover:bg-accent/30"
                >
                  {columns.map((col, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3">
                      {col.render
                        ? col.render(v)
                        : col.accessor
                          ? String(v[col.accessor])
                          : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No data available.
              </p>
            </div>
          )}
      </div>
    </div>
  );
};
