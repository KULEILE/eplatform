import React from 'react';

export default function EmptyState({ icon = '📄', title, message, action }) {
  return (
    <div className="card flex flex-col items-center py-12 text-center">
      <div className="mb-3 text-4xl" aria-hidden="true">{icon}</div>
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {message && <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
