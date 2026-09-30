import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadPhoto limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Replaces the old "Simulate photo capture" button on the National ID and Passport application
 * forms with a real photo upload: the citizen picks an image (camera roll or a live camera photo
 * on mobile, via capture="user"), it's uploaded immediately to POST /api/uploads/photo, and the
 * returned reference is what the form eventually submits as photoReference — exactly the same
 * field the backend already expected, just backed by a real image now instead of a fake string.
 *
 * Controlled component: value = photoReference (string|null), onChange(photoReference|null).
 */
export default function PhotoCapture({ value, onChange, label, help }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null); // local object URL, shown while/just after uploading
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('photoCapture.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('photoCapture.tooLarge'));
      return;
    }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const { photoReference } = await api.postForm('/uploads/photo', fd);
      onChange(photoReference);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      setPreview(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  function retake() {
    setPreview(null);
    onChange(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const displaySrc = preview || (value ? `/uploads/${value}` : null);

  return (
    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4 text-center">
      <p className="mb-2 text-sm font-medium text-slate-700">{label || t('photoCapture.label')}</p>
      {help && <p className="mb-2 text-xs text-slate-500">{help}</p>}

      {displaySrc ? (
        <div className="flex flex-col items-center gap-2">
          <img src={displaySrc} alt={t('photoCapture.previewAlt')} className="h-32 w-28 rounded border border-slate-200 object-cover" />
          {uploading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : value ? (
            <>
              <p className="text-sm text-gov-green">✓ {t('photoCapture.uploaded')}</p>
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('photoCapture.retake')}</button>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="user"
            onChange={onFileSelected}
            className="mx-auto block text-sm text-slate-600"
          />
          <p className="mt-2 text-xs text-slate-400">{t('photoCapture.hint')}</p>
        </>
      )}
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
