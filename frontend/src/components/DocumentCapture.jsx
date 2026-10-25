import React, { useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';

const MAX_BYTES = 8 * 1024 * 1024; // 8MB — matches backend/src/middleware/upload.js's uploadApplicationDocument limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
// requireLiveCapture mode (see below) never accepts a PDF — there's no camera-captured PDF.
const LIVE_CAPTURE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * A plain "upload a photo or scan of this document" field — the chief's letter, proof of birth,
 * marriage certificate, acknowledgement of paternity, and a non-citizen parent's passport on the
 * birth certificate application (see migration 059). Modelled on ReceiptCapture.jsx, but with no
 * reference-number text field, since these documents don't have one.
 *
 * Posts to POST /api/birth-certificate-applications/upload, which — unlike every other upload
 * endpoint in this system — is deliberately UNAUTHENTICATED, because the public birth
 * certificate application (BirthCertificateApplication.jsx) can be filled in by someone who has
 * no account at all yet. The logged-in parent's own birth registration form
 * (BirthRegistrationApply.jsx) uses this same component and endpoint too, purely to avoid
 * building two near-identical upload widgets — being logged in or not makes no difference to
 * this endpoint, which doesn't check for a session either way.
 *
 * requireLiveCapture (Batch 13 follow-up): most documents this component handles (a chief's
 * letter, a scanned certificate, a non-citizen parent's passport) may genuinely only exist as a
 * file the citizen already has saved, so the plain file picker stays the default. But for a proof
 * that's only meaningful if it was just photographed — the passport "pages full" last-page proof
 * is the first case — a saved file could be an old photo, a screenshot, or someone else's image
 * entirely, with nothing to stop it. Passing requireLiveCapture opens the device camera directly
 * (capture="environment", same idea as PhotoCapture.jsx's capture="user" for headshots) instead of
 * a generic file chooser, and drops PDF from what's accepted (there's no such thing as a
 * camera-captured PDF). This doesn't *prove* the page number matches what the citizen declared —
 * that's still the officer's call when they review the photo — it just closes off the laziest
 * fraud of reusing an unrelated saved image.
 *
 * Controlled component: value = documentReference (string|''), onChange(documentReference|'').
 */
export default function DocumentCapture({ value, onChange, label, help, required = false, requireLiveCapture = false }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null);
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const documentReference = value || '';
  const acceptedTypes = requireLiveCapture ? LIVE_CAPTURE_ACCEPTED_TYPES : ACCEPTED_TYPES;

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!acceptedTypes.includes(file.type)) {
      setError(t(requireLiveCapture ? 'documentCapture.wrongTypeLiveOnly' : 'documentCapture.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('documentCapture.tooLarge'));
      return;
    }
    setPreviewIsPdf(file.type === 'application/pdf');
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    const fd = new FormData();
    fd.append('document', file);
    try {
      const { documentReference: uploaded } = await api.postForm('/birth-certificate-applications/upload', fd);
      onChange(uploaded);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      setPreview(null);
      onChange('');
    } finally {
      setUploading(false);
    }
  }

  function retake() {
    setPreview(null);
    setPreviewIsPdf(false);
    onChange('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const displaySrc = preview || (documentReference ? `/uploads/${documentReference}` : null);

  return (
    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4 text-center">
      <p className="mb-2 text-sm font-medium text-slate-700">{label}{required && <span className="text-gov-red"> *</span>}</p>
      {help && <p className="mb-3 text-xs text-slate-500">{help}</p>}

      {displaySrc ? (
        <div className="flex flex-col items-center gap-2">
          {previewIsPdf ? (
            <p className="text-sm text-slate-600">📄 {t('documentCapture.pdfSelected')}</p>
          ) : (
            <img src={displaySrc} alt={label} className="h-32 w-28 rounded border border-slate-200 object-cover" />
          )}
          {uploading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : documentReference ? (
            <>
              <p className="text-sm text-gov-green">✓ {t('documentCapture.uploaded')}</p>
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t(requireLiveCapture ? 'documentCapture.retakeLiveOnly' : 'documentCapture.retake')}</button>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={acceptedTypes.join(',')}
            {...(requireLiveCapture ? { capture: 'environment' } : {})}
            onChange={onFileSelected}
            className="mx-auto block text-sm text-slate-600"
          />
          <p className="mt-2 text-xs text-slate-400">{t(requireLiveCapture ? 'documentCapture.hintLiveOnly' : 'documentCapture.hint')}</p>
        </>
      )}
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
