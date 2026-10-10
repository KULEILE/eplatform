import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadReceipt limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Proof-of-payment capture used wherever a service requires a fee before it can proceed (see
 * database/migrations/033_add_payment_receipt.sql for which services those are, and why). Asks
 * for both a payment reference number (typed) and a photo of the receipt/slip (uploaded to
 * POST /api/uploads/receipt, same pattern as PhotoCapture.jsx) — matching what was asked for:
 * a reference number AND an image, not either on its own.
 *
 * Controlled component: value = { paymentReference, receiptImageReference } (both string|''),
 * onChange(nextValue).
 */
export default function ReceiptCapture({ value, onChange, label, help }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null); // local object URL, shown while/just after uploading
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const paymentReference = value?.paymentReference || '';
  const receiptImageReference = value?.receiptImageReference || '';

  function updateReference(paymentReference) {
    onChange({ paymentReference, receiptImageReference });
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('receiptCapture.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('receiptCapture.tooLarge'));
      return;
    }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    const fd = new FormData();
    fd.append('receipt', file);
    try {
      const { receiptImageReference: uploaded } = await api.postForm('/uploads/receipt', fd);
      onChange({ paymentReference, receiptImageReference: uploaded });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      setPreview(null);
      onChange({ paymentReference, receiptImageReference: '' });
    } finally {
      setUploading(false);
    }
  }

  function retake() {
    setPreview(null);
    onChange({ paymentReference, receiptImageReference: '' });
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const displaySrc = preview || (receiptImageReference ? `/uploads/${receiptImageReference}` : null);

  return (
    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4">
      <p className="mb-2 text-sm font-medium text-slate-700">{label || t('receiptCapture.label')}</p>
      {help && <p className="mb-3 text-xs text-slate-500">{help}</p>}

      <label className="form-label" htmlFor="payment-reference">{t('receiptCapture.referenceLabel')}</label>
      <input
        id="payment-reference"
        type="text"
        className="form-input"
        value={paymentReference}
        onChange={(e) => updateReference(e.target.value)}
        placeholder={t('receiptCapture.referencePlaceholder')}
      />

      <p className="mb-2 mt-4 text-sm font-medium text-slate-700">{t('receiptCapture.imageLabel')}</p>
      <div className="text-center">
        {displaySrc ? (
          <div className="flex flex-col items-center gap-2">
            <img src={displaySrc} alt={t('receiptCapture.previewAlt')} className="h-32 w-28 rounded border border-slate-200 object-cover" />
            {uploading ? (
              <p className="text-sm text-slate-500">{t('common.loading')}</p>
            ) : receiptImageReference ? (
              <>
                <p className="text-sm text-gov-green">✓ {t('receiptCapture.uploaded')}</p>
                <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('receiptCapture.retake')}</button>
              </>
            ) : null}
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onFileSelected}
              className="mx-auto block text-sm text-slate-600"
            />
            <p className="mt-2 text-xs text-slate-400">{t('receiptCapture.hint')}</p>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}