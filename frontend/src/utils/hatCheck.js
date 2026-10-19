// Real hat/cap detection for ID-style photos, run entirely client-side — called from
// faceCheck.js's checkPhotoCompliance, never on its own.
//
// Uses PINTO0309/HHC (https://github.com/PINTO0309/HHC, MIT-licensed) — the "S" variant
// (495 KB, published F1 ≈ 0.97). Wired through ONNX Runtime Web.
//
// IMPORTANT FIXES in this version:
//   1. Letterboxing instead of stretching the head crop to 48×48 (the previous stretch
//      was the biggest source of false detections).
//   2. Slightly more generous top padding so high hair / tall hats are less likely to
//      be cut off.
//   3. Temporary console logging of the probability so real citizen photos can be
//      inspected and the threshold re-tuned if needed.
//
// Fails OPEN: if the WASM runtime or the model can't load, or inference throws for any
// reason, this returns { detected: false, skipped: true } rather than blocking a
// legitimate submission.

const ORT_WASM_DIR = '/models/ort/'; // ort-wasm-simd-threaded.{mjs,wasm}
const MODEL_URL = '/models/hhc_is_s_48x48.onnx';
const INPUT_SIZE = 48;

// Raised from the model's published default of 0.5. After letterboxing + better crop,
// 0.65–0.70 is usually a safer starting point for "don't falsely reject a real ID photo".
// Re-tune once you have 20–30 real local photos.
const HAT_THRESHOLD = 0.65;

let runtimePromise = null;

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      ort.env.wasm.numThreads = 1; // single image, single thread is enough
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
      });
      return { ort, session };
    })().catch((err) => {
      runtimePromise = null; // allow retry on next photo
      throw err;
    });
  }
  return runtimePromise;
}

/**
 * Approximates a head-only crop from face-api's 68-point landmarks.
 * Side padding = full jaw width on each side (already proven necessary).
 * Top padding increased to 1.6 × brow-to-chin so high hair / tall hats are less cut off.
 *
 * @returns {{x:number,y:number,width:number,height:number}} in source-image pixels
 */
function estimateHeadBox(faceBox, landmarks, imgW, imgH) {
  const jaw = landmarks.getJawOutline();          // 17 points
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();

  const chinY = jaw[8].y;
  const browTopY = Math.min(
    ...leftBrow.map((p) => p.y),
    ...rightBrow.map((p) => p.y)
  );
  const browToChin = Math.max(1, chinY - browTopY);

  const jawMinX = Math.min(...jaw.map((p) => p.x));
  const jawMaxX = Math.max(...jaw.map((p) => p.x));
  const jawWidth = Math.max(1, jawMaxX - jawMinX);

  // More generous top padding than the previous 1.3
  const top = Math.max(0, browTopY - browToChin * 1.6);
  const bottom = Math.min(imgH, chinY + browToChin * 0.5);
  const left = Math.max(0, jawMinX - jawWidth * 1.0);
  const right = Math.min(imgW, jawMaxX + jawWidth * 1.0);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement} imgEl
 * @param {{x:number,y:number,width:number,height:number}} faceBox
 * @param {object} landmarks  face-api FaceLandmarks68
 * @returns {Promise<{ detected: boolean, confidence: number, skipped?: boolean }>}
 */
export async function detectHat(imgEl, faceBox, landmarks) {
  try {
    if (!landmarks) {
      return { detected: false, confidence: 0, skipped: true };
    }

    const { ort, session } = await loadRuntime();

    const imgW = imgEl.naturalWidth || imgEl.width;
    const imgH = imgEl.naturalHeight || imgEl.height;
    const head = estimateHeadBox(faceBox, landmarks, imgW, imgH);

    if (head.width < 8 || head.height < 8) {
      return { detected: false, confidence: 0, skipped: true };
    }

    // ---------- Letterbox (preserve aspect ratio) ----------
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d');

    // Neutral mid-gray padding (model is less sensitive to this than to black/white)
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

    const scale = Math.min(INPUT_SIZE / head.width, INPUT_SIZE / head.height);
    const drawW = Math.round(head.width * scale);
    const drawH = Math.round(head.height * scale);
    const offsetX = Math.floor((INPUT_SIZE - drawW) / 2);
    const offsetY = Math.floor((INPUT_SIZE - drawH) / 2);

    ctx.drawImage(
      imgEl,
      head.x, head.y, head.width, head.height,
      offsetX, offsetY, drawW, drawH
    );
    // -------------------------------------------------------

    let pixels;
    try {
      pixels = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    } catch {
      // tainted canvas (cross-origin) — skip rather than block
      return { detected: false, confidence: 0, skipped: true };
    }

    // NCHW float32 [1, 3, 48, 48], RGB, values 0-1
    const plane = INPUT_SIZE * INPUT_SIZE;
    const float32 = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      float32[i]             = pixels[i * 4]     / 255; // R
      float32[i + plane]     = pixels[i * 4 + 1] / 255; // G
      float32[i + plane * 2] = pixels[i * 4 + 2] / 255; // B
    }

    const inputTensor = new ort.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const results = await session.run({ images: inputTensor });

    const hatProb = results.prob_wearing_hat?.data?.[0];
    if (typeof hatProb !== 'number' || !Number.isFinite(hatProb)) {
      return { detected: false, confidence: 0, skipped: true };
    }

    // Temporary debug — remove once you are happy with the threshold
    console.log('[hatCheck]', {
      hatProb: hatProb.toFixed(3),
      threshold: HAT_THRESHOLD,
      detected: hatProb >= HAT_THRESHOLD,
      headBox: head,
    });

    return {
      detected: hatProb >= HAT_THRESHOLD,
      confidence: Math.round(hatProb * 100),
    };
  } catch {
    return { detected: false, confidence: 0, skipped: true };
  }
}