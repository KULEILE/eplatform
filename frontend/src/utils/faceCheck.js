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
 *   - Blur/sharpness — a genuine, well-established measurement (Laplacian variance, see
 *     faceSharpness below), not a guess. Measured on just the face crop, not the whole photo, so
 *     a phone's portrait-mode background blur doesn't wrongly flag a photo with a sharp face.
 *   - "Busy background" — a best-effort heuristic (local edge/texture density sampled from above
 *     and beside the detected face — never below the chin, see isBackgroundBusy below), not true
 *     background classification. It will not catch everything a human reviewer would, but it
 *     catches the obvious cases (cluttered room, patterned wallpaper, a striped/tiled/brick wall)
 *     — see isBackgroundBusy for why this measures texture rather than raw color variance.
 *   - Head pose ("look straight at the camera") — a genuine geometric check using the 68-point
 *     facial landmark model (tiny variant, ~77KB, also served locally from /models): it measures
 *     whether the eyes are roughly level (not tilted) and whether the nose sits roughly midway
 *     between them (not turned to one side). It catches a clearly turned or tilted head; it is
 *     not a lab-grade 3D pose estimate, so small/natural variation is allowed through on purpose.
 *   - Hats / caps — a genuine, real detection, added after an earlier version of this comment
 *     wrongly claimed there's no free way to do this. See hatCheck.js for the model (PINTO0309/
 *     HHC, MIT-licensed, published F1 0.92-0.97) and its honest limits (an approximated head
 *     crop, a real ~11MB one-time runtime download). A detected hat is rejected with a specific
 *     reason, same as every other failure here — except a citizen can declare it's a religious
 *     head covering rather than fashion headwear and proceed anyway (see PhotoCapture.jsx); that
 *     declaration is self-reported, not verified, and is stored alongside the photo so an officer
 *     reviewing the application can see it was declared, not silently hidden.
 *   - Glasses — still NOT implemented. Reliably detecting glasses needs a trained facial
 *     attribute model or a paid cloud vision API; one small free option exists on npm
 *     ("glassesjs") but it's brand new (first published this year, only two point releases, and
 *     its own package metadata disagrees with itself about which repo/author it comes from) —
 *     not something worth depending on for a government system over citizens' real photos
 *     without it proving itself first. The citizen still confirms by checkbox (see
 *     PhotoCapture.jsx) that the photo has no glasses or other obstruction — a self-declaration,
 *     not automated detection, same as this file is honest that the background check is a
 *     heuristic.
 *
 * Fails OPEN, not closed: if a model can't load (offline, blocked asset, slow network) or
 * detection throws, this returns { ok: true, skipped: true } rather than blocking a legitimate
 * submission — the officer reviewing the application is still the final real check regardless.
 * It only fails CLOSED (ok: false) when a model actually ran and found a real problem.
 */
import * as faceapi from '@vladmandic/face-api';
import { detectHat } from './hatCheck';

const MODEL_URL = '/models';
// Face must occupy at least this fraction of the photo's area — catches "stood too far back".
const MIN_FACE_AREA_RATIO = 0.06;
// Face center must be within this fraction of image width/height from the true center —
// catches a face cropped off to one side or badly misaligned.
const MAX_CENTER_OFFSET_X = 0.22;
const MAX_CENTER_OFFSET_Y = 0.25;
// Below this, the face crop reads as blurry rather than sharp enough to be usable. This is the
// variance of a Laplacian (edge-detecting) filter applied to just the face region — see
// faceSharpness for the full explanation. Calibrated against real test photos and synthetically
// blurred copies of them: genuinely sharp photos scored 190–1040, while even a mild, barely
// visible softening already dropped that to 10–35, and a clearly blurry copy to under 10 — this
// threshold sits with large margin below every sharp measurement and above every blurred one.
const MIN_FACE_SHARPNESS = 40;
// Average local brightness gradient (how much luma changes between neighboring sample points)
// above this, sampled from the region outside the face, reads as a "busy"/patterned background.
// See isBackgroundBusy for why this measures texture rather than overall color spread, and for
// the measurements this was calibrated against.
const MAX_BACKGROUND_EDGE_GRADIENT = 3;
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

function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Sharpness of just the face region (with a little padding), via Laplacian variance — the
 * standard, well-established cheap blur detector: convolve with a 3x3 edge-detecting kernel, then
 * take the VARIANCE of the responses, not the mean. A sharp face has a mix of flat regions
 * (near-zero response) and crisp edges (large response), so the responses are spread out — high
 * variance. A blurry face has uniformly weak edges everywhere — low variance, even though the
 * overall brightness range can look similar either way. See MIN_FACE_SHARPNESS for the threshold
 * this was calibrated against.
 *
 * Deliberately scoped to the face crop, not the whole photo: a phone's portrait mode can
 * legitimately blur the background while keeping the face sharp, and that's a fine photo — the
 * thing that actually needs to be sharp is the face itself.
 *
 * @returns {number|null} the variance, or null if it couldn't be measured (too small / tainted
 * canvas) — the caller treats null as "skip this check" rather than blocking on it.
 */
function faceSharpness(imgEl, faceBox, imgW, imgH) {
  const pad = 0.15; // a little padding around the detected box so we're not measuring right at its edge
  const fx = Math.max(0, faceBox.x - faceBox.width * pad);
  const fy = Math.max(0, faceBox.y - faceBox.height * pad);
  const fw = Math.min(imgW - fx, faceBox.width * (1 + 2 * pad));
  const fh = Math.min(imgH - fy, faceBox.height * (1 + 2 * pad));
  if (fw < 10 || fh < 10) return null;

  // Enough resolution to judge sharpness without being slow — unlike the background check, this
  // can't be downscaled as aggressively, since shrinking an image destroys the very high-frequency
  // detail this is trying to measure.
  const targetMaxDim = 200;
  const scale = Math.min(1, targetMaxDim / Math.max(fw, fh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(fw * scale));
  canvas.height = Math.max(2, Math.round(fh * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, fx, fy, fw, fh, 0, 0, canvas.width, canvas.height);

  let data;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null; // tainted canvas (cross-origin source) — skip rather than block
  }

  const w = canvas.width, h = canvas.height;
  if (w < 3 || h < 3) return null;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }

  const responses = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = gray[y * w + x];
      const resp =
        gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + x - 1] + gray[y * w + x + 1] - 4 * c;
      responses.push(resp);
    }
  }
  if (responses.length < 20) return null;

  const mean = responses.reduce((a, b) => a + b, 0) / responses.length;
  const variance = responses.reduce((a, b) => a + (b - mean) ** 2, 0) / responses.length;
  return variance;
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
 * @param {HTMLImageElement|HTMLCanvasElement} imgEl - an already-loaded image, or a canvas
 * already drawn to (PhotoCapture.jsx's live camera capture passes a canvas holding the frame it
 * just grabbed from the video feed; its fallback file picker still passes a loaded Image).
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

  const sharpness = faceSharpness(imgEl, { x, y, width, height }, imgW, imgH);
  if (sharpness !== null && sharpness < MIN_FACE_SHARPNESS) {
    return { ok: false, reason: 'blurry' };
  }

  if (detections[0].landmarks && isNotFacingForward(detections[0].landmarks)) {
    return { ok: false, reason: 'notFacingForward' };
  }

  if (isBackgroundBusy(imgEl, { x, y, width, height }, imgW, imgH)) {
    return { ok: false, reason: 'busyBackground' };
  }

  // Run last and only once every cheaper check has passed: this is the one check that has to
  // load a ~11MB WASM runtime (see hatCheck.js) the first time it runs on a device, so a photo
  // that's going to be rejected anyway for being blurry, off-center, etc. never pays that cost.
  const hat = await detectHat(imgEl, { x, y, width, height }, detections[0].landmarks);
  if (hat.detected) {
    return { ok: false, reason: 'hat' };
  }

  return { ok: true };
}

/**
 * Samples "background" pixels to judge whether the backdrop is plain or patterned. Only ever
 * samples above and immediately beside the head — NEVER at or below chin height.
 *
 * Excluding clothing (fix #1): earlier this excluded just a padded rectangle sized to the FACE
 * (padX = 40% of face width) and treated everything outside that rectangle as background,
 * including the area below the chin. That's wrong: in a head-and-shoulders ID photo, the area
 * below the chin is shoulders/clothing, not backdrop, and shoulders are routinely much wider than
 * the face — a 40%-padded face-width rectangle doesn't come close to covering them. So a
 * perfectly plain wall behind someone wearing a shirt that contrasts with the wall (e.g. a dark
 * shirt against a light wall) would have shirt pixels and wall pixels both counted as
 * "background", producing a large color variance that read as "busy" even though the wall was
 * plain. Restricting sampling to above/beside the head sidesteps this entirely — clothing is
 * never touched, regardless of how wide the shoulders are or how much it contrasts with the wall.
 *
 * Measuring texture, not just color spread (fix #2): once clothing was excluded, overall color
 * variance turned out to be a weak signal on its own. The threshold had been tuned back when
 * clothing contamination inflated every reading; once that was removed, a genuinely patterned
 * wall (e.g. a striped ceiling, a concrete-block wall) scored only modestly higher than a plain
 * wall under normal uneven lighting — a window lighting one side of a room produces a real, wide
 * spread of colors too, just changing slowly across the frame rather than repeating. Measured on
 * real test photos: a smooth lighting gradient with NO pattern at all scored a *higher* overall
 * color spread than an actually patterned wall, while scoring almost no local edge gradient. So
 * this measures the average brightness change between each sampled point and its near neighbors
 * instead of overall color spread: a slow lighting gradient barely changes from one point to the
 * next nearby point (low local gradient, however wide its full range is end to end), while a
 * repeating pattern — stripes, grout lines, brick joints — alternates sharply at small, regular
 * intervals (high local gradient almost everywhere it's sampled). This tells texture apart from
 * lighting far better than color variance did.
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
  const step = 2; // sampling grid step
  const neighborStep = 2; // how far away the "neighbor" pixel is, for the local gradient

  const included = (px, py) => {
    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return false;
    if (py >= chinY) return false; // below the chin: shoulders/clothing, not backdrop
    if (px >= exMinX && px <= exMaxX && py >= exMinY) return false; // hair/face column
    return true;
  };

  let sampleCount = 0;
  const gradients = [];
  for (let py = 0; py < canvas.height; py += step) {
    if (py >= chinY) break;
    for (let px = 0; px < canvas.width; px += step) {
      if (!included(px, py)) continue;
      sampleCount++;
      const i = (py * canvas.width + px) * 4;
      const myLuma = luma(data[i], data[i + 1], data[i + 2]);

      if (included(px + neighborStep, py)) {
        const j = (py * canvas.width + (px + neighborStep)) * 4;
        gradients.push(Math.abs(myLuma - luma(data[j], data[j + 1], data[j + 2])));
      }
      if (included(px, py + neighborStep)) {
        const j = ((py + neighborStep) * canvas.width + px) * 4;
        gradients.push(Math.abs(myLuma - luma(data[j], data[j + 1], data[j + 2])));
      }
    }
  }
  if (sampleCount < 20 || gradients.length < 20) return false; // not enough visible background to judge

  const meanGradient = gradients.reduce((a, b) => a + b, 0) / gradients.length;

  return meanGradient > MAX_BACKGROUND_EDGE_GRADIENT;
}
