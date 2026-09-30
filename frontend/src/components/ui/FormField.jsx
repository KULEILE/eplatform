import React from 'react';

export default function FormField({ label, htmlFor, required, error, help, children }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="form-label">
        {label} {required && <span className="text-gov-red" aria-hidden="true">*</span>}
        {required && <span className="sr-only">(required)</span>}
      </label>
      {children}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      {error && (
        <p className="mt-1 flex items-center gap-1 text-sm text-gov-red" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </div>
  );
}
