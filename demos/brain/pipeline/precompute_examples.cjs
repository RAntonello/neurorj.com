#!/usr/bin/env node
/**
 * Rebuild examples.json using the demo's unchanged GPT-2 / encoding weights.
 * Requires Node >=18, the `ws` package, and Chrome with a debugging port:
 *   google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/brain-export-chrome
 *   node demos/brain/pipeline/precompute_examples.cjs [--port=9223] [--output=/path/examples.json]
 * Uses its own temporary browser tab and a local HTTP server; closes both on exit.
 * No package installation, model download, or website modification beyond the output file.
 * ONNX Runtime's pinned browser runtime is loaded from the same CDN as the original demo.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split(/=(.*)/s, 2)));
const port = Number(args.port || 9223);
const output = args.output ? path.resolve(args.output) : path.join(root, 'examples.json');
const ortVersion = '1.29.0';
const referenceImplementationSha256 = '7f3860aeb2fe426ef2191bf5b85246ce3f9c682c3504e57623b278d9f29ca724';
const examples = [
  ['places', 'I went to Paris, then Rome, then New York, and ended up in Boston.'],
  ['numbers', 'She counted the coins twice: seven quarters, three dimes, and a nickel, forty cents short of the bus fare.'],
  ['senses', "My father's hands were rough and smelled like sawdust and motor oil, and his coffee was always burnt."],
  ['people', 'He looked at her, and she looked away, and neither of them said what they had both been thinking for weeks.'],
  ['directions', 'Turn left at the light, go past the gas station, and the parking lot is behind the bank on your right.'],
  ['animals', 'The old dog limped across the yard, sniffed at the fence, and lay down in the sun.'],
  ['bad news', 'Then the doctor said the word cancer, and the whole room went quiet.'],
  ['food', 'Preheat the oven, toss the potatoes with olive oil, salt, and rosemary, and roast them for forty minutes.'],
];

// Same arithmetic, normalization, context start token, and six-word windows as
// the original demo.js. Float32 intermediates deliberately preserve its rounding.
async function computeInBrowser(examples, ortVersion) {
  const meta = await fetch('meta.json').then(r => r.json());
  const K = meta.K, D = meta.D, WIN = 6;
  const f32 = new Float32Array(await fetch('weights.bin').then(r => r.arrayBuffer()));
  let o = 0;
  const Wm = f32.subarray(o, o += K * D);
  const norm = { mean: f32.subarray(o, o += D), std: f32.subarray(o, o += D), predstd: f32.subarray(o, o += K) };
  const corr = f32.subarray(o, o += K);
  const normW = f32.length >= o + 2 * D + K
    ? { mean: f32.subarray(o, o += D), std: f32.subarray(o, o += D), predstd: f32.subarray(o, o += K) }
    : norm;
  const tokenizer = await GPT2Tokenizer.load('tokenizer/');
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;
  const model = await fetch(meta.model).then(r => r.arrayBuffer());
  // The dynamically quantized graph must use WASM; WebGPU is not equivalent.
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  function predictPatches(feat, nrm) {
    const z = new Float32Array(D);
    for (let j = 0; j < D; j++) z[j] = (feat[j] - nrm.mean[j]) / nrm.std[j];
    const vals = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      let s = 0; const row = k * D;
      for (let j = 0; j < D; j++) s += Wm[row + j] * z[j];
      vals[k] = s / nrm.predstd[k];
    }
    return Array.from(vals);
  }
  const results = [];
  for (const [label, originalText] of examples) {
    const text = originalText.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const { ids, tokens } = tokenizer.encode(text);
    const idsT = ids.slice(-1000), toksT = tokens.slice(-1000);
    const input = [50256, ...idsT];
    const feed = { input_ids: new ort.Tensor('int64', BigInt64Array.from(input.map(BigInt)), [1, input.length]) };
    const out = await session.run(feed);
    const h = out.hidden.data;
    const finals = [], words = [];
    let cur = '';
    for (let t = 0; t < idsT.length; t++) {
      cur += toksT[t].replace(/Ġ/g, ' ').replace(/Ċ/g, '\n');
      const isLast = t === idsT.length - 1;
      const next = isLast ? null : toksT[t + 1];
      const wordFinal = isLast || next.startsWith('Ġ') || next.startsWith('Ċ');
      if (!wordFinal) continue;
      if (toksT[t].trim() === '' || toksT[t] === 'Ċ') { cur = ''; continue; }
      finals.push(t + 1); words.push(cur.trim()); cur = '';
    }
    const feat = new Float32Array(D);
    for (const f of finals) for (let j = 0; j < D; j++) feat[j] += h[f * D + j];
    for (let j = 0; j < D; j++) feat[j] /= finals.length;
    const whole = predictPatches(feat, norm);
    const frames = [];
    for (let i = 0; i < finals.length; i++) {
      const fw = new Float32Array(D), a = Math.max(0, i - WIN + 1);
      for (let q = a; q <= i; q++) {
        const off = finals[q] * D;
        for (let j = 0; j < D; j++) fw[j] += h[off + j];
      }
      for (let j = 0; j < D; j++) fw[j] /= (i - a + 1);
      frames.push(predictPatches(fw, normW));
    }
    results.push({ id: label.replace(/ /g, '-'), label, text: originalText, words, whole, frames });
  }
  await session.release();
  return { patchCount: K, corr: Array.from(corr), corrMin: meta.corr_min, examples: results };
}

(async () => {
  const types = { '.js': 'application/javascript', '.json': 'application/json', '.txt': 'text/plain', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream' };
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><title>Brain example precomputation</title><script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/ort.min.js"></script><script src="tokenizer.js"></script>`);
      return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let ws, tab;
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then(r => r.json());
    ws = new WebSocket(tab.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    let next = 1;
    const pending = new Map();
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (!message.id) return;
      const promise = pending.get(message.id); pending.delete(message.id);
      if (message.error) promise.reject(new Error(JSON.stringify(message.error))); else promise.resolve(message.result);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = next++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    for (let i = 0; ; i++) {
      if (await evaluate('!!window.ort && !!window.GPT2Tokenizer')) break;
      if (i >= 240) throw new Error('Timed out loading the browser runtime');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const result = await evaluate(`(${computeInBrowser.toString()})(${JSON.stringify(examples)},${JSON.stringify(ortVersion)})`);
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const sourceSha256 = Object.fromEntries(['tokenizer.js', 'tokenizer/vocab.json', 'tokenizer/merges.txt', 'meta.json', 'weights.bin', 'gpt2_layer8_int8.onnx'].map(n => [n, hash(path.join(root, n))]));
    sourceSha256['pipeline/precompute_examples.cjs'] = hash(__filename);
    const artifact = {
      version: 1,
      patchCount: result.patchCount,
      corr: result.corr,
      corrMin: result.corrMin,
      provenance: {
        algorithm: 'GPT-2 layer 8 word-final states, original encoding weights and normalization',
        windowWords: 6,
        model: 'gpt2_layer8_int8.onnx',
        runtime: `onnxruntime-web ${ortVersion} / WASM`,
        decimalPlaces: 7,
        referenceImplementationSha256,
        sourceSha256,
      },
      examples: result.examples.map(example => ({
        ...example,
        whole: example.whole.map(value => Number(value.toFixed(7))),
        frames: example.frames.map(frame => frame.map(value => Number(value.toFixed(7)))),
      })),
    };
    // Keep held-out correlations exact, preserving the visibility threshold.
    const rounded = JSON.stringify(artifact);
    fs.writeFileSync(output, rounded + '\n');
    console.log(`Wrote ${artifact.examples.length} examples, ${artifact.examples.reduce((s, x) => s + x.frames.length, 0)} frames, ${Buffer.byteLength(rounded) + 1} bytes: ${output}`);
  } finally {
    if (tab) await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
    if (ws) ws.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
