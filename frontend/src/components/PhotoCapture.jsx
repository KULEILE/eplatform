import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
// Dynamically imported (see runComplianceCheck) rather than a static import at the top of the
// file: this module pulls in @vladmandic/face-api, which bundles TensorFlow.js (~1.4MB). A
// static import here would put that weight in the main app bundle, loaded on every single page —
// login, dashboard, everything — even though only a handful of face-photo fields ever need it.
// A dynamic import() lets the bundler split it into its own chunk, fetched only when a citizen
// actually captures a photo on a faceCheck-enabled field.

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches backend/src/middleware/upload.js's uploadPhoto limit
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Replaces the old "Simulate photo capture" button on the National ID and Passport application
 * forms with a real photo upload: the returned reference is what the form eventually submits as
 * photoReference — exactly the same field the backend already expected, just backed by a real
 * image now instead of a fake string.
 *
 * Controlled component: value = photoReference (string|null), onChange(photoReference|null).
 *
 * `faceCheck`: set this on real ID-style face photos (National ID, passport, driving licence/
 * permit photos) — NOT on document scans (ownership proof, insurance proof, receipts), which
 * legitimately contain no face and still use a plain file picker below. When set, this field
 * behaves very differently from a plain upload field, for a reason a citizen flagged directly:
 * a plain <input type="file"> only opens a live camera on a PHONE — on a laptop or desktop
 * browser, the `capture` attribute does nothing at all, and the browser just shows an ordinary
 * "choose a file from disk" picker, which defeats the entire point of an ID photo (anyone could
 * submit any existing image, including someone else's photo, or a screenshot). So a faceCheck
 * field now opens a REAL live camera feed via getUserMedia() on every device — the same approach
 * BiometricCapture.jsx and HandScan.jsx already use for hand scans — with the front ("user")
 * camera, a visible live preview, and a "Take photo" button the citizen presses themselves. Only
 * when getUserMedia genuinely isn't available (no camera, permission denied, or an old/insecure
 * browser context) does this fall back to a plain file picker — see cameraUnavailable below —
 * and that fallback is now the clearly-labelled exception, not the default experience it used to
 * be on every non-phone device.
 *
 * Every captured frame — live or from the fallback file picker — is run through a client-side
 * face check (see utils/faceCheck.js) before it's accepted/uploaded: it must show exactly one
 * reasonably-centered, reasonably-sized face, facing the camera, against a background that isn't
 * obviously busy. A frame that fails is rejected with a specific reason so the citizen can
 * recapture it, rather than being silently accepted and only caught later by an officer.
 *
 * `faceCheck` fields also require the citizen to tick a confirmation checkbox once the photo is
 * uploaded, before the field counts as filled — one more honest layer on top of the real
 * automated checks below, not a substitute for them.
 *
 * `faceCheck` fields also show a short instructions screen BEFORE the citizen reaches the camera
 * (remove hat, sunglasses, headphones; plain background; hold steady), not just the confirmation
 * checkbox after — this is prevention (stop the mistake before it happens).
 *
 * HAT/CAP/GLASSES/FACE-OBSTRUCTION DETECTION IS SERVER-SIDE, AFTER UPLOAD — not part of the
 * client-side checkPhotoCompliance() call above (see faceCheck.js's header for why that moved: an
 * earlier on-device model proved unreliable on real photos). This component still uploads the
 * photo the moment it passes the quick client-side checks (face found, framed, sharp,
 * forward-facing, plain background), the same as before — uploadFile() just also now has to
 * handle the backend rejecting it afterwards, via a non-2xx response carrying a `reason` (see
 * api/client.js — it attaches the parsed response body as err.data). The real UX tradeoff: for
 * these specific issues, the citizen no longer finds out while the camera is still open — they
 * find out after the upload completes and have to reopen the camera to retake. Every OTHER
 * rejection reason (no face, blurry, off-center, busy background, etc.) still happens instantly
 * client-side, before upload, exactly as before.
 *
 * NO OVERRIDE, NO EXCEPTIONS: a server-side rejection for ANY reason — hat, cap, glasses, face
 * obstruction, bad face count, unclear — is treated identically: the preview is discarded, a
 * reason-specific bilingual message is shown, and the citizen simply retakes the photo. There
 * used to be a religious-head-covering self-declaration that let a detected hat/cap through
 * anyway; that has been removed at the citizen's/operator's explicit request, so that a flagged
 * photo can never pass no matter what the citizen declares. (The backend's compliance-note
 * storage and the officer-facing amber badge on existing records still exist for old records —
 * see uploads.controller.js's doc comment — but this component no longer offers or sends one.)
 */
export default function PhotoCapture({ value, onChange, label, help, faceCheck = false }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null); // local object URL / data URL, shown while/just after uploading
  const [uploading, setUploading] = useState(false);
  const [checking, setChecking] = useState(false); // running the client-side face/background check
  const [error, setError] = useState('');
  // When faceCheck is set, an uploaded photo is held here until the citizen ticks the obstruction
  // confirmation checkbox — onChange(photoReference) only fires once both are true, so the field
  // reads as "incomplete" (same as any other required field) until then.
  const [pendingRef, setPendingRef] = useState(null);
  const [confirmed, setConfirmed] = useState(!!value); // a value already on mount (e.g. resubmit prefill) counts as already confirmed
  // Gates the camera behind the instructions screen on faceCheck fields — see the class doc
  // comment above. Irrelevant (never read) on non-faceCheck fields, which go straight to the
  // plain file input as before.
  const [instructionsAcknowledged, setInstructionsAcknowledged] = useState(false);
  const [scanning, setScanning] = useState(false); // live camera feed is open (faceCheck fields only)
  const [cameraUnavailable, setCameraUnavailable] = useState(false); // fall back to a plain file picker
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);

  // Always stop the camera's tracks when the scan ends (captured, cancelled, flagged, or the
  // component unmounts) — otherwise the browser's camera-in-use indicator stays on indefinitely.
  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }
  useEffect(() => () => stopStream(), []);

  async function startCamera() {
    setError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraUnavailable(true);
      return;
    }
    try {
      // 'user' (front/selfie camera) — this is a photo OF the citizen themselves, unlike
      // BiometricCapture's 'environment' camera, which photographs a hand held out away from them.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setScanning(true);
      // The <video> element only exists once `scanning` renders it, so attach the stream next tick.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 0);
    } catch {
      // Permission denied, no camera present, or an insecure context — fall back rather than
      // leaving the citizen stuck with no way to proceed at all.
      setCameraUnavailable(true);
    }
  }

  function cancelCamera() {
    stopStream();
    setScanning(false);
    setInstructionsAcknowledged(false); // show the instructions again before the next attempt
  }

  function runComplianceCheck(imgSource) {
    return (async () => {
      try {
        const { checkPhotoCompliance } = await import('../utils/faceCheck');
        return await checkPhotoCompliance(imgSource);
      } catch {
        return { ok: true, skipped: true }; // fail open — never block on an infra hiccup
      }
    })();
  }

  // `blob` is either a File from the fallback file picker (keep its own name/extension — e.g. a
  // .jpg stays a .jpg) or a raw Blob from a live camera capture (always PNG — see captureNow's
  // canvas.toBlob call — so it gets a matching .png name; the server reads the real mime type
  // off the blob itself for Content-Type when serving it back either way, but a file_key whose
  // extension actually matches its bytes is worth getting right rather than leaving misleading).
  async function uploadFile(blob, objectUrl) {
    setPreview(objectUrl);
    setUploading(true);
    const fd = new FormData();
    fd.append('photo', blob, blob.name || 'capture.png');
    // Tells the backend whether to run the real hat/cap/glasses/face-obstruction detector (see
    // uploads.controller.js) — only faceCheck fields should pay for that call; a plain document
    // scan (e.g. the naturalization form's chief's letter) shares this same endpoint and has no
    // face to check at all.
    if (faceCheck) fd.append('faceCheck', 'true');
    try {
      const { photoReference } = await api.postForm('/uploads/photo', fd);
      if (faceCheck) {
        // Hold it back from the parent form until the citizen confirms below.
        setPendingRef(photoReference);
        setConfirmed(false);
        onChange(null);
      } else {
        onChange(photoReference);
      }
    } catch (err) {
      // err.data is the parsed JSON response body (see api/client.js) — uploads.controller.js
      // sends { error, reason } for a worn-accessory/face-obstruction rejection specifically, so
      // this photo can get the same bilingual, reason-specific message as a client-side rejection
      // instead of a generic "something went wrong". Every server-side rejection reason (hat,
      // glasses, faceObstruction, faceCount, unclear) is handled identically: the photo is
      // discarded, the message is shown, and the citizen retakes it — no override, no exceptions.
      const serverReason = err.data?.reason;
      setError((serverReason && t(`photoCapture.${serverReason}`)) || err.message || t('common.somethingWentWrong'));
      setPreview(null);
      setPendingRef(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  // Captures the current live-camera frame, runs it through the client-side compliance check
  // (face presence/framing/sharpness/pose/background — see faceCheck.js), and either uploads it
  // or leaves the camera running so the citizen can simply reposition and press "Take photo"
  // again, rather than restarting the whole flow. Hat/cap/glasses/face-obstruction rejections
  // (including the religious-head-covering flag) can no longer happen here — that check now runs
  // server-side, after the upload this falls through to below (see uploadFile).
  async function captureNow() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setError('');

    setChecking(true);
    const result = faceCheck ? await runComplianceCheck(canvas) : { ok: true };
    setChecking(false);

    if (!result.ok) {
      setError(t(`photoCapture.${result.reason}`));
      // Camera stays open — citizen adjusts and presses "Take photo" again.
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      stopStream();
      setScanning(false);
      uploadFile(blob, URL.createObjectURL(blob));
    }, 'image/png');
  }

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

    const objectUrl = URL.createObjectURL(file);

    if (faceCheck) {
      setChecking(true);
      const img = await new Promise((resolve) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => resolve(null);
        el.src = objectUrl;
      });
      const result = img ? await runComplianceCheck(img) : { ok: true, skipped: true };
      setChecking(false);
      if (!result.ok) {
        setError(t(`photoCapture.${result.reason}`));
        URL.revokeObjectURL(objectUrl);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }
    }

    await uploadFile(file, objectUrl);
  }

  function onConfirmToggle(e) {
    const checked = e.target.checked;
    setConfirmed(checked);
    onChange(checked ? (pendingRef || value) : null);
  }

  function retake() {
    setPreview(null);
    setPendingRef(null);
    setConfirmed(false);
    setCameraUnavailable(false);
    setInstructionsAcknowledged(false); // show the instructions again — see class doc comment
    onChange(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const effectiveRef = pendingRef || value;
  const displaySrc = preview || (effectiveRef ? `/uploads/${effectiveRef}` : null);

  return (
    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4 text-center">
      <p className="mb-2 text-sm font-medium text-slate-700">{label || t('photoCapture.label')}</p>
      {help && <p className="mb-2 text-xs text-slate-500">{help}</p>}

      {displaySrc ? (
        <div className="flex flex-col items-center gap-2">
          <img src={displaySrc} alt={t('photoCapture.previewAlt')} className="h-32 w-28 rounded border border-slate-200 object-cover" />
          {uploading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : effectiveRef ? (
            <>
              <p className="text-sm text-gov-green">✓ {t('photoCapture.uploaded')}</p>
              {faceCheck && (
                <label className="flex max-w-xs items-start gap-2 text-left text-xs text-slate-600">
                  <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={onConfirmToggle} />
                  <span>{t('photoCapture.obstructionConfirm')}</span>
                </label>
              )}
              <button type="button" className="btn-secondary !py-1 !text-xs" onClick={retake}>{t('photoCapture.retake')}</button>
            </>
          ) : null}
        </div>
      ) : checking ? (
        <p className="text-sm text-slate-500">{t('photoCapture.checking')}</p>
      ) : faceCheck && !instructionsAcknowledged ? (
        <div className="rounded-md bg-amber-50 p-3 text-left text-sm text-slate-700">
          <p className="mb-2 font-semibold text-slate-800">{t('photoCapture.instructions.title')}</p>
          <ul className="mb-3 list-disc space-y-1 pl-4 text-xs">
            <li>{t('photoCapture.instructions.noHat')}</li>
            <li>{t('photoCapture.instructions.noGlasses')}</li>
            <li>{t('photoCapture.instructions.noHeadphones')}</li>
            <li>{t('photoCapture.instructions.lookStraight')}</li>
            <li>{t('photoCapture.instructions.plainBackground')}</li>
            <li>{t('photoCapture.instructions.steady')}</li>
          </ul>
          <button
            type="button"
            className="btn-primary !py-1 !text-xs"
            onClick={() => { setInstructionsAcknowledged(true); startCamera(); }}
          >
            {t('photoCapture.instructions.continue')}
          </button>
        </div>
      ) : faceCheck && scanning ? (
        <div className="flex flex-col items-center gap-3">
          {/* Live front-camera feed — a real capture, not a file picker — see the class doc
              comment above for why this replaced a plain <input type="file"> on faceCheck fields. */}
          <div className="relative mx-auto h-40 w-36 overflow-hidden rounded border-2 border-gov-navy bg-black">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-2 rounded border-2 border-dashed border-white/70" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary !py-1 !text-xs" onClick={captureNow}>{t('photoCapture.captureNow')}</button>
            <button type="button" className="btn-secondary !py-1 !text-xs" onClick={cancelCamera}>{t('common.cancel')}</button>
          </div>
          <p className="text-xs text-slate-400">{t('photoCapture.scanInProgressHint')}</p>
        </div>
      ) : faceCheck && cameraUnavailable ? (
        <>
          <p className="mb-2 text-xs text-gov-amber">⚠ {t('photoCapture.cameraUnavailable')}</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="user"
            onChange={onFileSelected}
            className="mx-auto block text-sm text-slate-600"
          />
          <p className="mt-2 text-xs text-slate-400">{t('photoCapture.cameraFallbackHint')}</p>
        </>
      ) : faceCheck ? (
        // instructionsAcknowledged is true but neither scanning nor cameraUnavailable yet — a
        // brief moment while the getUserMedia permission prompt is pending, or a fallback entry
        // point if startCamera() hasn't run yet for any reason.
        <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={startCamera}>{t('photoCapture.startCamera')}</button>
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
      <canvas ref={canvasRef} className="hidden" />
      {error && <p className="mt-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
    </div>
  );
}
