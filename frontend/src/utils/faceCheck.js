/**
 * Client-side photo compliance check for real ID-style photos (National ID, passport, driving
 * licence/permit photos) — NOT used for document scans (ownership proof, insurance proof,
 * receipts), which legitimately contain no face at all. PhotoCapture.jsx only calls this when
 * rendered with `faceCheck` set, which the pages that use it for a real face photo opt into.
 *
 * What this can and can't do, honestly:
 *   - Face presence/count and rough framing (centered, reasonably sized in-frame) — a genuine,
 *     reliable browser-side check using a small face-detection model (TinyFaceDetector, ~190KB,
 *     served from /models so there's no dependency on a third-party CDN at runtime).
 *   - "Busy background" — a best-effort heuristic (color variance in the region outside the
 *     detected face), not true background classification. It will not catch everything a human
 *     reviewer would, but it catches the obvious cases (cluttered room, patterned wallpaper).
 *   - Hats / glasses — NOT implemented here. Reliably detecting those needs a trained facial
 *     attribute model or a paid cloud vision API, which is out of scope for this check. See the
 *     conversation this was scoped in for why.
 *
 * Fails OPEN, not closed: if the model can't load (offline, blocked asset, slow network) or
 * detection throws, this returns { ok: true, skipped: true } rather than blocking a legitimate
 * submission — the officer reviewing the application is still the final real check regardless.
 * It only fails CLOSED (ok: false) when the model actually ran and found a real problem.
 */
import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models';
// Face must occupy at least this fraction of the photo's area — catches "stood too far back".
const MIN_FACE_AREA_RATIO = 0.06;
// Face center must be within this fraction of image width/height from the true center —
// catches a face cropped off to one side or badly misaligned.
const MAX_CENTER_OFFSET_X = 0.22;
const MAX_CENTER_OFFSET_Y = 0.25;
// Combined RGB standard deviation above this, sampled from the region outside the face, reads as
// a "busy" background rather than a plain wall/backdrop. Picked conservatively so uneven lighting
// on a plain wall doesn't trip it.
const BUSY_BACKGROUND_STD_DEV = 55;

let modelLoadPromise = null;

function loadModels() {
  if (!modelLoadPromise) {
    modelLoadPromise = faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  }
  return modelLoadPromise;
}

/**
 * @param {HTMLImageElement} imgEl - an already-loaded (complete) image element.
 * @returns {Promise<{ ok: boolean, reason?: string, skipped?: boolean }>}
 */
export async function checkPhotoCompliance(imgEl) {
  try {
    await loadModels();
  } catch {
    return { ok: true, skipped: true };
  }

  let detections;
  try {
    detections = await faceapi.detectAllFaces(
      imgEl,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    );
  } catch {
    return { ok: true, skipped: true };
  }

  if (!detections || detections.length === 0) {
    return { ok: false, reason: 'noFace' };
  }
  if (detections.length > 1) {
    return { ok: false, reason: 'multipleFaces' };
  }

  const { x, y, width, height } = detections[0].box;
  const imgW = imgEl.naturalWidth || imgEl.width;
  const imgH = imgEl.naturalHeight || imgEl.height;
  if (!imgW || !imgH) return { ok: true, skipped: true };

  const faceAreaRatio = (width * height) / (imgW * imgH);
  if (faceAreaRatio < MIN_FACE_AREA_RATIO) {
    return { ok: false, reason: 'tooFar' };
  }

  const faceCenterX = x + width / 2;
  const faceCenterY = y + height / 2;
  const offsetX = Math.abs(faceCenterX - imgW / 2) / imgW;
  const offsetY = Math.abs(faceCenterY - imgH / 2) / imgH;
  if (offsetX > MAX_CENTER_OFFSET_X || offsetY > MAX_CENTER_OFFSET_Y) {
    return { ok: false, reason: 'offCenter' };
  }

  if (isBackgroundBusy(imgEl, { x, y, width, height }, imgW, imgH)) {
    return { ok: false, reason: 'busyBackground' };
  }

  return { ok: true };
}

function isBackgroundBusy(imgEl, faceBox, imgW, imgH) {
  const canvas = document.createElement('canvas');
  // Downscale for speed — this only needs a rough estimate, not pixel-perfect analysis.
  const scale = Math.min(1, 160 / Math.max(imgW, imgH));
  canvas.width = Math.max(1, Math.round(imgW * scale));
  canvas.height = Math.max(1, Math.round(imgH * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);

  let data;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // Canvas tainted (cross-origin source) — skip rather than block.
    return false;
  }

  const fx = faceBox.x * scale;
  const fy = faceBox.y * scale;
  const fw = faceBox.width * scale;
  const fh = faceBox.height * scale;
  // Exclude a padded region around the face so hair/shoulders aren't counted as "background".
  const padX = fw * 0.4;
  const padY = fh * 0.6;
  const exMinX = fx - padX;
  const exMaxX = fx + fw + padX;
  const exMinY = fy - padY;
  const exMaxY = fy + fh + padY * 1.8; // extra allowance below the face for shoulders

  const samples = [];
  for (let py = 0; py < canvas.height; py += 2) {
    for (let px = 0; px < canvas.width; px += 2) {
      if (px >= exMinX && px <= exMaxX && py >= exMinY && py <= exMaxY) continue;
      const i = (py * canvas.width + px) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (samples.length < 20) return false; // not enough visible background to judge

  const mean = samples
    .reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0])
    .map((v) => v / samples.length);
  const variance =
    samples.reduce(
      (acc, [r, g, b]) => acc + (r - mean[0]) ** 2 + (g - mean[1]) ** 2 + (b - mean[2]) ** 2,
      0
    ) / samples.length;
  const stdDev = Math.sqrt(variance);

  return stdDev > BUSY_BACKGROUND_STD_DEV;
}