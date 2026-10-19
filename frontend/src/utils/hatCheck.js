// Real hat/cap detection for ID-style photos, run entirely client-side — called from
// faceCheck.js's checkPhotoCompliance, never on its own.
//
// This exists because an earlier version of faceCheck.js's header comment said "there's no free,
// reliable way to detect hats/glasses client-side". That was wrong for hats specifically: a real,
// credible, free model for exactly this does exist — PINTO0309/HHC
// (https://github.com/PINTO0309/HHC, MIT-licensed), a tiny binary "is this head wearing a hat"
// classifier, published with its own measured F1 scores (0.92-0.97 across its size variants on
// its own test set) rather than being invented for this project. This file wires the "S" variant
// (495KB, F1 0.95 per its README) in via ONNX Runtime Web, running on-device.
//
// WHAT THIS ACTUALLY COSTS, HONESTLY: the model file itself is tiny, but ONNX Runtime Web's
// WebAssembly engine that runs it is ~11MB (see public/models/ort/) — one-time per device, then
// cached by the browser, and only fetched on a page with a faceCheck-enabled photo field, never
// on every page load. That is still a much bigger download than everything else this app loads
// client-side combined (the face-detection + landmark models below are under 300KB together).
// This was a known, deliberate tradeoff when this was built, not an oversight: if Lesotho's
// mobile data costs make this a real complaint, the fix is converting this same HHC model to run
// on the TensorFlow.js runtime this app already loads for face detection (see
// @vladmandic/face-api) instead of adding a second, separate ML runtime — that conversion was
// attempted and hit real tooling friction (a numpy/tensorflowjs version conflict) and was not
// pursued further for this delivery.
//
// WHAT THE MODEL EXPECTS, AND THE REAL BUG THIS CAUSED THE FIRST TIME: PINTO0309/HHC was trained
// on head crops produced by the author's own dedicated head-detector model. This project has no
// such head detector — only face-api's face box and 68-point landmarks (see faceCheck.js) — so
// estimateHeadBox() below approximates that same region from the landmarks instead. The FIRST
// version of this approximation was far too TIGHT (eyebrows-to-chin with only ~8% side padding),
// and a citizen reported it rejecting every single photo, including a completely bare head with
// no hat at all. That was reproduced and root-caused directly against the real photo from their
// report (not guessed at): run through the actual downloaded model, a tight eyebrows-to-chin crop
// of that photo scored 0.97 ("wearing a hat") even though there is no hat anywhere in it, while
// the same photo's full, uncropped frame scored 0.01. A parameter sweep across side/bottom margin
// on that same real photo — plus a positive control made by compositing a fake dark cap onto the
// top of that same real head — found that a TOO-TIGHT crop is specifically what this model reads
// as "hat": padding the crop out to roughly the full jaw width on each side, and about half the
// eyebrow-to-chin distance below the chin, dropped the real bare-head photo to 0.19 while the
// same crop on the fake-cap version scored 0.82 — a wide, comfortable margin either side of the
// 0.5 line. HAT_THRESHOLD below was also raised from the model's own published default (0.5) to
// 0.6 for extra headroom against a false rejection, since blocking a real ID photo outright is a
// far worse failure here than occasionally letting an actual hat through to the officer who
// reviews every submission anyway.
//
// HONEST LIMIT ON THIS FIX: it's calibrated against exactly ONE real reported photo plus one
// synthetic positive control built from it — not a proper labelled dataset, because none exists
// for this project. The margins above (0.19 vs 0.82) are wide enough that this should hold up
// across real variation, but if it still misfires on a different photo — rejects a bare head, or
// waves through an obvious hat — report what happened (ideally the photo) so the crop or
// threshold can be recalibrated against that case too, the same way MIN_FACE_SHARPNESS and
// MAX_BACKGROUND_EDGE_GRADIENT elsewhere in this file's sibling, faceCheck.js, were tuned
// against real captures rather than guessed once and left alone.
//
// WHAT THIS ACTUALLY COSTS, HONESTLY: the model file itself is tiny, but ONNX Runtime Web's
// WebAssembly engine that runs it is ~11MB (see public/models/ort/) — one-time per device, then
// cached by the browser, and only fetched on a page with a faceCheck-enabled photo field, never
// on every page load. That is still a much bigger download than everything else this app loads
// client-side combined (the face-detection + landmark models below are under 300KB together).
// This was a known, deliberate tradeoff when this was built, not an oversight: if Lesotho's
// mobile data costs make this a real complaint, the fix is converting this same HHC model to run
// on the TensorFlow.js runtime this app already loads for face detection (see
// @vladmandic/face-api) instead of adding a second, separate ML runtime — that conversion was
// attempted and hit real tooling friction (a numpy/tensorflowjs version conflict) and was not
// pursued further for this delivery.
//
// Fails OPEN like every check in faceCheck.js: if the WASM runtime or the model can't load, or
// inference throws for any reason, this returns { detected: false, skipped: true } rather than
// blocking a legitimate submission on an infrastructure hiccup.

const ORT_WASM_DIR = '/models/ort/'; // ort-wasm-simd-threaded.{mjs,wasm}, copied from node_modules/onnxruntime-web/dist
const MODEL_URL = '/models/hhc_is_s_48x48.onnx';
const INPUT_SIZE = 48; // fixed by the model — see its ONNX input shape [batch, 3, 48, 48]
// Raised from the model's own published default of 0.5 — see the file header for the real-photo
// calibration (0.19 bare-head vs 0.82 with-hat) this sits comfortably between, and why the extra
// margin toward "don't reject" is the right side to err on here.
const HAT_THRESHOLD = 0.6;

let runtimePromise = null;

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      // This model is tiny and only ever runs on one image at a time — a single worker thread is
      // plenty, and avoids this silently trying (and possibly failing, depending on whether this
      // server sends the COOP/COEP headers SharedArrayBuffer needs) to use multiple threads.
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
      return { ort, session };
    })().catch((err) => {
      runtimePromise = null; // don't cache a failure forever — allow a retry on the next photo
      throw err;
    });
  }
  return runtimePromise;
}

/**
 * Approximates a head-only crop from face-api's 68-point landmarks — see the file header for the
 * real-photo debugging that set these specific margins (and for why the first, tighter version of
 * this function was the actual cause of "rejects every photo"). Side padding is a full jaw-width
 * on each side, not a small fraction of it; bottom padding extends about half the eyebrow-to-chin
 * distance below the chin. Both are wide margins by normal cropping intuition — that width is the
 * fix, not an accident: this model reads a too-tight crop as "hat" far more than a loose one.
 *
 * @returns {{x:number,y:number,width:number,height:number}} in SOURCE image pixel coordinates.
 */
function estimateHeadBox(faceBox, landmarks, imgW, imgH) {
  const jaw = landmarks.getJawOutline(); // 17 points: left ear -> chin -> right ear
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();
  const chinY = jaw[8].y;
  const browTopY = Math.min(...leftBrow.map((p) => p.y), ...rightBrow.map((p) => p.y));
  const browToChin = Math.max(1, chinY - browTopY);
  const jawMinX = Math.min(...jaw.map((p) => p.x));
  const jawMaxX = Math.max(...jaw.map((p) => p.x));
  const jawWidth = Math.max(1, jawMaxX - jawMinX);

  const top = Math.max(0, browTopY - browToChin * 1.3);
  const bottom = Math.min(imgH, chinY + browToChin * 0.5);
  const left = Math.max(0, jawMinX - jawWidth * 1.0);
  const right = Math.min(imgW, jawMaxX + jawWidth * 1.0);

  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * @param {HTMLImageElement} imgEl - an already-loaded (complete) image element.
 * @param {{x:number,y:number,width:number,height:number}} faceBox - detections[0].detection.box
 * @param {object} landmarks - detections[0].landmarks (face-api FaceLandmarks68), required
 * @returns {Promise<{ detected: boolean, confidence: number, skipped?: boolean }>}
 */
export async function detectHat(imgEl, faceBox, landmarks) {
  try {
    if (!landmarks) return { detected: false, confidence: 0, skipped: true };
    const { ort, session } = await loadRuntime();

    const imgW = imgEl.naturalWidth || imgEl.width;
    const imgH = imgEl.naturalHeight || imgEl.height;
    const head = estimateHeadBox(faceBox, landmarks, imgW, imgH);
    if (head.width < 8 || head.height < 8) return { detected: false, confidence: 0, skipped: true };

    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, head.x, head.y, head.width, head.height, 0, 0, INPUT_SIZE, INPUT_SIZE);

    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data; // RGBA — canvas data is already RGB-ordered, no BGR swap needed
    } catch {
      return { detected: false, confidence: 0, skipped: true }; // tainted canvas (cross-origin source)
    }

    // NCHW float32 [1, 3, 48, 48], values 0-1, channel order R,G,B — matches PINTO0309/HHC's own
    // preprocessing (resize -> convert to RGB -> divide by 255 -> transpose HWC to CHW), inspected
    // directly from its demo_hhc.py rather than guessed.
    const plane = INPUT_SIZE * INPUT_SIZE;
    const float32 = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      float32[i] = pixels[i * 4] / 255;
      float32[i + plane] = pixels[i * 4 + 1] / 255;
      float32[i + plane * 2] = pixels[i * 4 + 2] / 255;
    }

    const inputTensor = new ort.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ images: inputTensor });
    // The model's output is a single sigmoid probability per image (NOT two class logits needing
    // softmax — confirmed by inspecting the ONNX graph directly: output name "prob_wearing_hat",
    // shape [batch]). An earlier draft of this integration assumed a 2-class softmax output,
    // which would have been a real bug: softmax over a single value always returns 1.0, which
    // would have made this report "wearing a hat" at 100% confidence on every single photo.
    const hatProb = results.prob_wearing_hat?.data?.[0];
    if (typeof hatProb !== 'number' || !Number.isFinite(hatProb)) {
      return { detected: false, confidence: 0, skipped: true };
    }

    return { detected: hatProb >= HAT_THRESHOLD, confidence: Math.round(hatProb * 100) };
  } catch {
    return { detected: false, confidence: 0, skipped: true };
  }
}
