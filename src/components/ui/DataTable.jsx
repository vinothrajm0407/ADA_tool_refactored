export default function DataTable({ columns, children, className = '', cellBorders = false }) {
  return (
    <div className={`bg-white border border-gray-100 rounded-xl overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((col, i) => {
                const { label, align } = typeof col === 'string' ? { label: col } : col;
                return (
                  <th
                    key={label + i}
                    scope="col"
                    className={`whitespace-nowrap ${align === 'right' ? 'text-right' : ''} ${cellBorders && i < columns.length - 1 ? 'border-r border-gray-100' : ''}`}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
