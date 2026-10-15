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
 *   - "Busy background" — a best-effort heuristic (color variance sampled from above and beside
 *     the detected face — never below the chin, see isBackgroundBusy below), not true background
 *     classification. It will not catch everything a human reviewer would, but it catches the
 *     obvious cases (cluttered room, patterned wallpaper).
 *   - Head pose ("look straight at the camera") — a genuine geometric check using the 68-point
 *     facial landmark model (tiny variant, ~77KB, also served locally from /models): it measures
 *     whether the eyes are roughly level (not tilted) and whether the nose sits roughly midway
 *     between them (not turned to one side). It catches a clearly turned or tilted head; it is
 *     not a lab-grade 3D pose estimate, so small/natural variation is allowed through on purpose.
 *   - Hats / glasses — NOT implemented here. Reliably detecting those needs a trained facial
 *     attribute model or a paid cloud vision API, which is out of scope for this check. Instead,
 *     the citizen confirms by checkbox (see PhotoCapture.jsx) that the photo has no such
 *     obstruction — a self-declaration, not automated detection, same as this file is honest
 *     that the background check is a heuristic.
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
// Roll (head tilt): the vertical gap between the two eyes, as a fraction of the distance between
// them. 0 = perfectly level. Above this reads as a tilted head.
const MAX_EYE_TILT_RATIO = 0.18;
// Yaw (head turned left/right): how far the nose sits from the horizontal midpoint between the
// eyes, as a fraction of the eye-to-eye distance. 0 = nose exactly centered. Above this reads as
// a head turned to one side rather than facing the camera.
const MAX_NOSE_OFFSET_RATIO = 0.25;

let modelLoadPromise = null;

function loadModels() {
  if (!modelLoadPromise) {
    modelLoadPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    ]);
  }
  return modelLoadPromise;
}

function averagePoint(points) {
  const n = points.length;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / n, y: sum.y / n };
}

/**
 * Forward-facing check using the 68-point landmarks: eyes should be roughly level (small roll)
 * and the nose should sit roughly midway between them (small yaw). Returns true when the face
 * looks clearly turned or tilted rather than facing the camera.
 */
function isNotFacingForward(landmarks) {
  const leftEye = averagePoint(landmarks.getLeftEye());
  const rightEye = averagePoint(landmarks.getRightEye());
  const nose = averagePoint(landmarks.getNose());

  const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  if (eyeDist < 1) return false; // degenerate detection — don't block on it

  const tiltRatio = Math.abs(rightEye.y - leftEye.y) / eyeDist;
  if (tiltRatio > MAX_EYE_TILT_RATIO) return true;

  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const noseOffsetRatio = Math.abs(nose.x - eyeMidX) / eyeDist;
  if (noseOffsetRatio > MAX_NOSE_OFFSET_RATIO) return true;

  return false;
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
    detections = await faceapi
      .detectAllFaces(imgEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true); // true = use the tiny landmark net, to match TinyFaceDetector
  } catch {
    return { ok: true, skipped: true };
  }

  if (!detections || detections.length === 0) {
    return { ok: false, reason: 'noFace' };
  }
  if (detections.length > 1) {
    return { ok: false, reason: 'multipleFaces' };
  }

  const { x, y, width, height } = detections[0].detection.box;
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

  if (detections[0].landmarks && isNotFacingForward(detections[0].landmarks)) {
    return { ok: false, reason: 'notFacingForward' };
  }

  if (isBackgroundBusy(imgEl, { x, y, width, height }, imgW, imgH)) {
    return { ok: false, reason: 'busyBackground' };
  }

  return { ok: true };
}

/**
 * Samples "background" pixels to measure how plain/uniform the backdrop is. Only ever samples
 * above and immediately beside the head — NEVER at or below chin height.
 *
 * Earlier this excluded just a padded rectangle sized to the FACE (padX = 40% of face width) and
 * treated everything outside that rectangle as background, including the area below the chin.
 * That's wrong: in a head-and-shoulders ID photo, the area below the chin is shoulders/clothing,
 * not backdrop, and shoulders are routinely much wider than the face — a 40%-padded face-width
 * rectangle doesn't come close to covering them. So a perfectly plain wall behind someone wearing
 * a shirt that contrasts with the wall (e.g. a dark shirt against a light wall) would have shirt
 * pixels and wall pixels both counted as "background", producing a large color variance that read
 * as a "busy"/patterned background even though the actual wall was plain. Restricting sampling to
 * above/beside the head sidesteps the problem entirely — clothing is never touched, regardless of
 * how wide the shoulders are or how much it contrasts with the wall.
 */
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
  // Narrow side margin excluded next to the face/hair (not shoulder-width — doesn't need to be,
  // since rows at or below the chin are skipped outright below).
  const padX = fw * 0.4;
  // How far above the face hair plausibly extends.
  const padY = fh * 0.6;
  const exMinX = fx - padX;
  const exMaxX = fx + fw + padX;
  const exMinY = fy - padY;
  const chinY = fy + fh; // nothing at or below this row is ever sampled — see comment above.

  const samples = [];
  for (let py = 0; py < canvas.height; py += 2) {
    if (py >= chinY) break; // below the chin: shoulders/clothing territory, not backdrop
    for (let px = 0; px < canvas.width; px += 2) {
      if (px >= exMinX && px <= exMaxX && py >= exMinY) continue; // hair/face column
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