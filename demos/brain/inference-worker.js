/* global ort, GPT2Tokenizer */
// The numerical model and feature construction are unchanged from the original
// demo. This worker moves loading and inference off the interface's thread.
const RUNTIME = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/";
const MAX_TOKENS = 1000;
const WINDOW_WORDS = 6;
let assetsPromise = null;
let requestQueue = Promise.resolve();

function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function fetchAsset(path) {
  const response = await fetch(new URL(path, self.location.href));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

function finiteArray(values, expected, label) {
  if (!values || values.length !== expected) throw new Error(`${label} has an unexpected size.`);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error(`${label} contains a non-finite value.`);
  }
}

async function initialize(progress) {
  progress({ stage: "loading", message: "Loading the model for custom text…" });
  // tokenizer.js is shared with the original page and exports onto window.
  self.window = self;
  if (!self.GPT2Tokenizer) importScripts(new URL("./tokenizer.js", self.location.href).href);
  if (!self.ort) importScripts(`${RUNTIME}ort.min.js`);
  ort.env.wasm.wasmPaths = RUNTIME;

  const meta = await (await fetchAsset("meta.json")).json();
  const { K, D } = meta;
  if (!Number.isInteger(K) || K <= 0 || !Number.isInteger(D) || D <= 0 || typeof meta.model !== "string") {
    throw new Error("Model metadata is invalid.");
  }
  const [weightBuffer, vocab, merges] = await Promise.all([
    fetchAsset("weights.bin").then(response => response.arrayBuffer()),
    fetchAsset("tokenizer/vocab.json").then(response => response.json()),
    fetchAsset("tokenizer/merges.txt").then(response => response.text()),
  ]);
  const weights = new Float32Array(weightBuffer);
  const originalSize = K * D + 2 * D + 2 * K;
  if (weights.length !== originalSize && weights.length !== originalSize + 2 * D + K) {
    throw new Error("Encoding weights have an unexpected size.");
  }
  finiteArray(weights, weights.length, "Encoding weights");
  let offset = 0;
  const Wm = weights.subarray(offset, offset += K * D);
  const norm = {
    mean: weights.subarray(offset, offset += D),
    std: weights.subarray(offset, offset += D),
    predstd: weights.subarray(offset, offset += K),
  };
  offset += K; // Held-out correlations are used by the renderer, not inference.
  const normW = weights.length >= offset + 2 * D + K ? {
    mean: weights.subarray(offset, offset += D),
    std: weights.subarray(offset, offset += D),
    predstd: weights.subarray(offset, offset += K),
  } : norm;
  for (const normalization of [norm, normW]) {
    if (normalization.std.some(value => value <= 0) || normalization.predstd.some(value => value <= 0)) {
      throw new Error("Encoding normalization contains an invalid scale.");
    }
  }
  const tokenizer = new GPT2Tokenizer(vocab, merges);

  const response = await fetchAsset(meta.model);
  // Content-Length may describe the compressed transfer; use the known size.
  const total = Number(meta.model_bytes) || Number(response.headers.get("Content-Length")) || 0;
  let model;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let lastUpdate = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        const now = performance.now();
        if (now - lastUpdate > 120 || (total && loaded >= total)) {
          progress({ stage: "loading", loaded, total, message: "Downloading GPT-2…" });
          lastUpdate = now;
        }
      }
    } finally {
      reader.releaseLock();
    }
    model = new Uint8Array(loaded);
    let position = 0;
    for (const chunk of chunks) { model.set(chunk, position); position += chunk.length; }
  } else {
    model = new Uint8Array(await response.arrayBuffer());
  }
  if (meta.model_bytes && model.byteLength !== meta.model_bytes) {
    throw new Error("The model download was incomplete.");
  }
  progress({ stage: "loading", loaded: model.byteLength, total: total || model.byteLength, message: "Preparing the model…" });
  // WASM only: WebGPU gives incorrect outputs for this dynamically quantized graph.
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  return { K, D, Wm, norm, normW, tokenizer, session };
}

async function getAssets(progress) {
  if (!assetsPromise) {
    assetsPromise = initialize(progress).catch(error => {
      assetsPromise = null;
      throw failure(`Could not load the custom-text model. Check your connection and try again. ${error.message}`, "MODEL_LOAD");
    });
  }
  return assetsPromise;
}

function predictPatches(feature, normalization, assets) {
  const { K, D, Wm } = assets;
  const z = new Float32Array(D);
  for (let j = 0; j < D; j++) z[j] = (feature[j] - normalization.mean[j]) / normalization.std[j];
  const values = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    let sum = 0;
    const row = k * D;
    for (let j = 0; j < D; j++) sum += Wm[row + j] * z[j];
    values[k] = sum / normalization.predstd[k];
  }
  finiteArray(values, K, "Predicted response");
  return values;
}

async function predict(rawText, progress) {
  if (typeof rawText !== "string") throw failure("Enter a passage to predict its response.", "INPUT_EMPTY");
  // Training transcripts were lowercase and without punctuation.
  const text = rawText.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw failure("Enter a passage with English words or numbers to predict its response.", "INPUT_EMPTY");
  const assets = await getAssets(progress);
  const { K, D, tokenizer, session, norm, normW } = assets;
  progress({ stage: "running", message: "Predicting the response…" });
  const start = performance.now();
  const { ids, tokens } = tokenizer.encode(text);
  if (!ids.length) throw failure("This passage has no supported tokens. Try English words or numbers.", "INPUT_EMPTY");
  // Preserve the original context cap, including its word-boundary behavior.
  const idsT = ids.slice(-MAX_TOKENS);
  const toksT = tokens.slice(-MAX_TOKENS);
  const input = [50256, ...idsT];
  let tensor;
  let output;
  try {
    tensor = new ort.Tensor("int64", BigInt64Array.from(input.map(BigInt)), [1, input.length]);
    output = await session.run({ input_ids: tensor });
    const hidden = output.hidden;
    if (!hidden || hidden.dims.length !== 3 || hidden.dims[0] !== 1 || hidden.dims[1] !== input.length || hidden.dims[2] !== D) {
      throw new Error("GPT-2 returned an unexpected hidden-state shape.");
    }
    const h = hidden.data;
    finiteArray(h, input.length * D, "GPT-2 hidden states");

    const finals = [], words = [];
    let current = "";
    for (let t = 0; t < idsT.length; t++) {
      current += toksT[t].replace(/Ġ/g, " ").replace(/Ċ/g, "\n");
      const isLast = t === idsT.length - 1;
      const next = isLast ? null : toksT[t + 1];
      const wordFinal = isLast || next.startsWith("Ġ") || next.startsWith("Ċ");
      if (!wordFinal) continue;
      if (toksT[t].trim() === "" || toksT[t] === "Ċ") { current = ""; continue; }
      finals.push(t + 1); // Skip the training context-start token.
      words.push(current.trim());
      current = "";
    }
    if (!finals.length) throw failure("Nothing to predict. Try a passage with English words or numbers.", "INPUT_EMPTY");

    const feature = new Float32Array(D);
    for (const final of finals) for (let j = 0; j < D; j++) feature[j] += h[final * D + j];
    for (let j = 0; j < D; j++) feature[j] /= finals.length;
    const wholeVals = predictPatches(feature, norm, assets);
    const wordVals = [];
    for (let i = 0; i < finals.length; i++) {
      const windowFeature = new Float32Array(D);
      const first = Math.max(0, i - WINDOW_WORDS + 1);
      for (let q = first; q <= i; q++) {
        const offset = finals[q] * D;
        for (let j = 0; j < D; j++) windowFeature[j] += h[offset + j];
      }
      for (let j = 0; j < D; j++) windowFeature[j] /= i - first + 1;
      wordVals.push(predictPatches(windowFeature, normW, assets));
    }
    if (wordVals.length !== words.length || wholeVals.length !== K) throw new Error("Prediction has an unexpected shape.");
    return {
      words, wordVals, wholeVals, ntok: idsT.length,
      ms: Math.round(performance.now() - start),
      truncated: ids.length > MAX_TOKENS,
      inputTokenCount: ids.length,
    };
  } catch (error) {
    // Discard a failed runtime session so the next request can recover.
    assetsPromise = null;
    try { await session.release(); } catch (_) { /* Already-failed sessions may not release. */ }
    if (error.code) throw error;
    throw failure(`Could not predict this passage. Try again, or use a shorter passage if your browser is low on memory. ${error.message}`, "INFERENCE_FAILED");
  } finally {
    tensor?.dispose?.();
    if (output) for (const value of Object.values(output)) value.dispose?.();
  }
}

self.onmessage = ({ data }) => {
  if (data.type !== "predict") return;
  // Serialize requests: one cached runtime session, no overlapping memory spikes.
  requestQueue = requestQueue.then(async () => {
    const progress = value => self.postMessage({ type: "progress", id: data.id, progress: value });
    try {
      const result = await predict(data.text, progress);
      self.postMessage({ type: "result", id: data.id, result }, [result.wholeVals.buffer, ...result.wordVals.map(values => values.buffer)]);
    } catch (error) {
      self.postMessage({ type: "error", id: data.id, error: { message: error.message || "Prediction failed. Please try again.", code: error.code || "INFERENCE_FAILED" } });
    }
  });
};
