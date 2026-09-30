import React from 'react';
import EmptyState from './EmptyState';
import { useLanguage } from '../../context/LanguageContext';

/**
 * columns: [{ key, header, render?: (row) => node }]
 */
export default function DataTable({ columns, rows, emptyTitle, emptyMessage, rowKey = 'id' }) {
  const { t } = useLanguage();
  if (!rows || rows.length === 0) {
    return <EmptyState title={emptyTitle || t('common.noResults')} message={emptyMessage} />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[640px] divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className="px-4 py-3 font-semibold text-slate-600">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row[rowKey]} className="hover:bg-slate-50">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 align-top text-slate-700">
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
