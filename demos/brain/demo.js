(async function () {
  const $ = id => document.getElementById(id);
  const status = msg => { $("status").textContent = msg; };
  const DIR = "./";
  const WIN = 6; // words per window in the timeline view (about one TR of speech)

  // ---------- assets ----------
  const meta = await fetch(DIR + "meta.json").then(r => r.json());
  const K = meta.K, D = meta.D;

  const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const [patchImg, curvImg, roiImg] = await Promise.all([
    loadImage(DIR + "patch_index.png"), loadImage(DIR + "curvature.png"), loadImage(DIR + "rois.png")]);
  const W = patchImg.width, H = patchImg.height;

  // patch index per pixel (uint16 in R,G; B>0 marks a valid pixel)
  const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.drawImage(patchImg, 0, 0);
  const pd = tctx.getImageData(0, 0, W, H).data;
  const pidx = new Int32Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) pidx[i] = pd[p + 2] > 0 ? (pd[p] | (pd[p + 1] << 8)) : -1;

  // weights: float32 W[K*D], mean[D], std[D], predstd[K], corr[K], mean_w[D], std_w[D], predstd_w[K]
  const wbuf = await fetch(DIR + "weights.bin").then(r => r.arrayBuffer());
  const f32 = new Float32Array(wbuf);
  let o = 0;
  const Wm = f32.subarray(o, o += K * D);
  const norm = { mean: f32.subarray(o, o += D), std: f32.subarray(o, o += D), predstd: f32.subarray(o, o += K) };
  const corr = f32.subarray(o, o += K);
  const normW = f32.length >= o + 2 * D + K
    ? { mean: f32.subarray(o, o += D), std: f32.subarray(o, o += D), predstd: f32.subarray(o, o += K) }
    : norm;

  // tokenizer + model
  const tokenizer = await GPT2Tokenizer.load(DIR + "tokenizer/");
  status("Loading GPT-2 (" + meta.model_mb + " MB, cached by your browser after the first visit)…");
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/";
  const resp = await fetch(DIR + meta.model);
  // Content-Length is the compressed size when the server gzips the file, so prefer the known model size
  const total = meta.model_bytes || +resp.headers.get("Content-Length") || 0;
  const reader = resp.body.getReader(); const chunks = []; let got = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length;
    if (total) status(`Loading GPT-2… ${Math.min(got, total) / 1e6 | 0} / ${total / 1e6 | 0} MB`);
  }
  const model = new Uint8Array(got); { let p = 0; for (const c of chunks) { model.set(c, p); p += c.length; } }
  // WASM (CPU) only: the WebGPU provider produces wrong outputs for this int8 dynamically-quantized graph.
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  status("Ready.");
  $("go").disabled = false;
  window.__dbg = { norm, normW, corr, Wm, session };

  // ---------- drawing ----------
  const canvas = $("brain"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const overlay = document.createElement("canvas"); overlay.width = W; overlay.height = H;
  const octx = overlay.getContext("2d");
  const oimg = octx.createImageData(W, H);

  // diverging colormap: blue (-) .. white .. red (+), input in [-1, 1]
  function cmap(v) {
    const t = Math.max(-1, Math.min(1, v));
    if (t < 0) { const a = -t; return [Math.round(255 * (1 - a) + 33 * a), Math.round(255 * (1 - a) + 102 * a), Math.round(255 * (1 - a) + 172 * a)]; }
    const a = t; return [Math.round(255 * (1 - a) + 178 * a), Math.round(255 * (1 - a) + 24 * a), Math.round(255 * (1 - a) + 43 * a)];
  }
  const VMAX = 2.0; // display range in units of each patch's typical predicted response
  function paint(vals) {
    const d = oimg.data;
    const rgb = new Array(K), alpha = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      if (vals === null || corr[k] < meta.corr_min) { rgb[k] = [0, 0, 0]; alpha[k] = 0; continue; }
      const v = vals[k] / VMAX;
      rgb[k] = cmap(v); alpha[k] = Math.min(1, Math.abs(v)) * 0.9;
    }
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const k = pidx[i];
      if (k < 0 || alpha[k] === 0) { d[p + 3] = 0; continue; }
      d[p] = rgb[k][0]; d[p + 1] = rgb[k][1]; d[p + 2] = rgb[k][2]; d[p + 3] = Math.round(255 * alpha[k]);
    }
    octx.putImageData(oimg, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(curvImg, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    ctx.drawImage(roiImg, 0, 0, W, H);
  }
  { const cb = $("cbar"); cb.width = 160; cb.height = 12; const c = cb.getContext("2d");
    for (let x = 0; x < 160; x++) { const [r, g, b] = cmap((x / 159) * 2 - 1); c.fillStyle = `rgb(${r},${g},${b})`; c.fillRect(x, 0, 1, 12); } }
  paint(null);

  // ---------- prediction ----------
  // feature -> patch values, in units of each patch's typical predicted response
  function predictPatches(feat, nrm) {
    const z = new Float32Array(D);
    for (let j = 0; j < D; j++) z[j] = (feat[j] - nrm.mean[j]) / nrm.std[j];
    const vals = new Float32Array(K);
    for (let k = 0; k < K; k++) { let s = 0; const row = k * D; for (let j = 0; j < D; j++) s += Wm[row + j] * z[j]; vals[k] = s / nrm.predstd[k]; }
    return vals;
  }

  let state = null;   // { words, wordVals (per-word windowed maps), wholeVals }
  let shown = null;   // the patch values currently painted
  let timer = null;

  function showWhole() {
    stopPlay();
    shown = state.wholeVals; paint(shown);
    $("pos").value = state.words.length - 1;
    renderWords(-1);
    status(`${state.words.length} words, ${state.ntok} tokens, ${state.ms} ms. Whole text.`);
  }
  function showAt(i) {
    shown = state.wordVals[i]; paint(shown);
    renderWords(i);
    status(`Word ${i + 1} of ${state.words.length}: "${state.words[i]}" (window of the last ${Math.min(WIN, i + 1)} words).`);
  }
  function renderWords(cur) {
    const el = $("words"); el.innerHTML = "";
    state.words.forEach((w, i) => {
      const sp = document.createElement("span"); sp.textContent = w;
      if (cur >= 0 && i <= cur && i > cur - WIN) sp.className = i === cur ? "cur" : "win";
      sp.addEventListener("click", () => { stopPlay(); $("pos").value = i; showAt(i); });
      el.appendChild(sp); el.appendChild(document.createTextNode(" "));
    });
  }
  function stopPlay() { if (timer) { clearInterval(timer); timer = null; $("play").innerHTML = "&#9654; Play"; } }
  function play() {
    if (timer) { stopPlay(); return; }
    let i = +$("pos").value; if (i >= state.words.length - 1) i = -1;
    $("play").textContent = "Pause";
    timer = setInterval(() => {
      i++; if (i >= state.words.length) { stopPlay(); return; }
      $("pos").value = i; showAt(i);
    }, 350);
  }

  async function predict() {
    stopPlay();
    // the training transcripts are lowercase with no punctuation, so match that distribution
    const text = $("text").value.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;
    $("go").disabled = true; status("Running GPT-2…");
    const t0 = performance.now();
    const { ids, tokens } = tokenizer.encode(text);
    if (ids.length === 0) { status("No tokens."); $("go").disabled = false; return; }
    const MAXT = 1000;
    const idsT = ids.slice(-MAXT), toksT = tokens.slice(-MAXT);
    const input = [50256, ...idsT]; // <|endoftext|> as the context start token, as during training
    const feed = { input_ids: new ort.Tensor("int64", BigInt64Array.from(input.map(BigInt)), [1, input.length]) };
    const out = await session.run(feed);
    const h = out.hidden.data; // [1, T, D]
    // word-final tokens (the training features used each word's last token) and the words they end
    const finals = [], words = [];
    let cur = "";
    for (let t = 0; t < idsT.length; t++) {
      cur += toksT[t].replace(/Ġ/g, " ").replace(/Ċ/g, "\n");
      const isLast = t === idsT.length - 1;
      const next = isLast ? null : toksT[t + 1];
      const wordFinal = isLast || next.startsWith("Ġ") || next.startsWith("Ċ");
      if (!wordFinal) continue;
      if (toksT[t].trim() === "" || toksT[t] === "Ċ") { cur = ""; continue; }
      finals.push(t + 1); words.push(cur.trim()); cur = ""; // +1 skips the start token
    }
    if (finals.length === 0) { status("Nothing to predict."); $("go").disabled = false; return; }
    // whole-text feature: mean over all word-final states
    const feat = new Float32Array(D);
    for (const f of finals) for (let j = 0; j < D; j++) feat[j] += h[f * D + j];
    for (let j = 0; j < D; j++) feat[j] /= finals.length;
    const wholeVals = predictPatches(feat, norm);
    // per-word feature: mean over the trailing WIN word-final states
    const wordVals = [];
    for (let i = 0; i < finals.length; i++) {
      const fw = new Float32Array(D); const a = Math.max(0, i - WIN + 1);
      for (let q = a; q <= i; q++) { const off = finals[q] * D; for (let j = 0; j < D; j++) fw[j] += h[off + j]; }
      for (let j = 0; j < D; j++) fw[j] /= (i - a + 1);
      wordVals.push(predictPatches(fw, normW));
    }
    state = { words, wordVals, wholeVals, ntok: idsT.length, ms: Math.round(performance.now() - t0) };
    window.__lastVals = wholeVals; window.__state = state;
    $("timeline").hidden = false;
    $("pos").max = words.length - 1;
    showWhole();
    $("caption").textContent = "";
    $("go").disabled = false;
  }
  $("go").addEventListener("click", predict);
  $("text").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); predict(); } });
  $("pos").addEventListener("input", () => { if (!state) return; stopPlay(); showAt(+$("pos").value); });
  $("play").addEventListener("click", () => { if (state) play(); });
  $("whole").addEventListener("click", e => { e.preventDefault(); if (state) showWhole(); });

  // examples
  const examples = [
    ["places", "I went to Paris, then Rome, then New York, and ended up in Boston."],
    ["numbers", "She counted the coins twice: seven quarters, three dimes, and a nickel, forty cents short of the bus fare."],
    ["senses", "My father's hands were rough and smelled like sawdust and motor oil, and his coffee was always burnt."],
    ["people", "He looked at her, and she looked away, and neither of them said what they had both been thinking for weeks."],
    ["directions", "Turn left at the light, go past the gas station, and the parking lot is behind the bank on your right."],
    ["animals", "The old dog limped across the yard, sniffed at the fence, and lay down in the sun."],
    ["bad news", "Then the doctor said the word cancer, and the whole room went quiet."],
    ["food", "Preheat the oven, toss the potatoes with olive oil, salt, and rosemary, and roast them for forty minutes."],
  ];
  examples.forEach(([label, ex]) => {
    const a = document.createElement("a"); a.href = "#"; a.textContent = label;
    a.addEventListener("click", e => { e.preventDefault(); $("text").value = ex; predict(); });
    $("examples").appendChild(a);
  });

  // hover: show the value of the patch under the cursor
  canvas.addEventListener("mousemove", e => {
    if (!shown) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * W / r.width), y = Math.floor((e.clientY - r.top) * H / r.height);
    const k = pidx[y * W + x];
    if (k < 0) { $("caption").textContent = ""; return; }
    $("caption").textContent = corr[k] < meta.corr_min
      ? `Patch ${k}: model has no predictive power here (held-out r = ${corr[k].toFixed(2)}).`
      : `Patch ${k}: predicted response ${shown[k] >= 0 ? "+" : ""}${shown[k].toFixed(2)} typical units (held-out r = ${corr[k].toFixed(2)}).`;
  });
})().catch(e => { document.getElementById("status").textContent = "Error: " + e.message; console.error(e); });
