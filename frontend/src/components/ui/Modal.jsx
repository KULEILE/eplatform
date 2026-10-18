import React, { useEffect, useRef } from 'react';

export default function Modal({ open, onClose, title, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    if (open && ref.current) ref.current.focus();
  }, [open]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && open) onClose?.();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        // flex-col + max-h-[90vh] on the panel, with only the body (not the header/footer)
        // scrolling: previously this had no height limit at all, so a modal with a lot of
        // content (e.g. a detail view with several photos) simply ran off the bottom of the
        // screen with no way to scroll down to the rest of it or to the action buttons below.
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl focus:outline-none"
      >
        <div className="flex shrink-0 items-start justify-between p-6 pb-4">
          <h2 id="modal-title" className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="mt-6 flex shrink-0 justify-end gap-3 p-6 pt-0">{footer}</div>}
      </div>
    </div>
  );
}
