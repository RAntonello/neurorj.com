// Precompute corpus scores using the unchanged /demos/brain/ browser model.
// Requires Node.js, ws, the local site on port 8877, and a Chrome CDP endpoint.
// GCT_CDP_PORT=9223 node demos/gct/scripts/score_corpus.cjs
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const crypto = require('crypto'), WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const snippets = [...html.matchAll(/<span data-corpus-id="([^"]+)" data-topic="([^"]+)">([^<]+)<\/span>/g)]
    .map(([, id, topic, text]) => ({ id, topic, text }));
  if (snippets.length !== 48 || snippets.filter(s => s.topic === 'location').length < 10) throw Error('Unexpected corpus.');
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(root, 'brain-surface.bin.gz')));
  const n = raw.readUInt32LE(4), ni = raw.readUInt32LE(8);
  const points = new Float32Array(raw.buffer, raw.byteOffset + 16, n * 3);
  const faces = new Uint32Array(raw.buffer, raw.byteOffset + 16 + n * 12, ni);
  const labels = new Uint16Array(raw.buffer, raw.byteOffset + 16 + n * 12 + ni * 4, n);
  const unfolded = zlib.gunzipSync(fs.readFileSync(path.join(root, 'brain-unfold.bin.gz')));
  if (unfolded.readUInt32LE(4) !== n) throw Error('ROI and model vertex orders do not match.');
  const mask = new Uint8Array(unfolded.buffer, unfolded.byteOffset + 16 + n * 24, n);
  const area = new Float64Array(n);
  for (let i = 0; i < ni; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2];
    const ux = points[b * 3] - points[a * 3], uy = points[b * 3 + 1] - points[a * 3 + 1], uz = points[b * 3 + 2] - points[a * 3 + 2];
    const vx = points[c * 3] - points[a * 3], vy = points[c * 3 + 1] - points[a * 3 + 1], vz = points[c * 3 + 2] - points[a * 3 + 2];
    const share = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    area[a] += share; area[b] += share; area[c] += share;
  }
  const meta = JSON.parse(fs.readFileSync(path.join(root, '../brain/meta.json')));
  const weightBytes = fs.readFileSync(path.join(root, '../brain/weights.bin'));
  const weights = new Float32Array(weightBytes.buffer, weightBytes.byteOffset, weightBytes.byteLength / 4);
  const corrOffset = meta.K * meta.D + 2 * meta.D + meta.K;
  const patchArea = new Float64Array(meta.K);
  let roiArea = 0, retainedArea = 0, roiVertices = 0, retainedVertices = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    roiVertices++; roiArea += area[i];
    const k = labels[i];
    if (k >= meta.K || weights[corrOffset + k] < meta.corr_min) continue;
    retainedVertices++; retainedArea += area[i]; patchArea[k] += area[i];
  }
  if (!retainedArea) throw Error('No reliable RSC model patches.');
  const roiWeights = Array.from(patchArea, (value, patch) => ({ patch, weight: value / retainedArea })).filter(p => p.weight > 0);
  console.log('RSC aggregation:', roiWeights.length, 'patches;', retainedVertices, '/', roiVertices, 'vertices;', (retainedArea / roiArea * 100).toFixed(1) + '% of ROI area');

  const tabs = await (await fetch(`http://127.0.0.1:${process.env.GCT_CDP_PORT || 9223}/json`)).json();
  const tab = tabs.find(t => t.url.includes('/demos/brain/')) || tabs.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolve => ws.on('open', resolve));
  let seq = 0; const pending = new Map();
  ws.on('message', bytes => {
    const message = JSON.parse(bytes);
    if (!message.id) return;
    const request = pending.get(message.id); pending.delete(message.id);
    message.error ? request.reject(message.error) : request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    await call('Page.enable'); await call('Network.enable');
    await call('Network.setCacheDisabled', { cacheDisabled: true });
    await call('Page.navigate', { url: 'http://127.0.0.1:8877/demos/brain/' });
    for (let i = 0; i < 180 && !await evaluate('!!window.__dbg'); i++) await delay(500);
    if (!await evaluate('!!window.__dbg')) throw Error('Model did not load.');
    for (const snippet of snippets) {
      await evaluate(`window.__state = null; document.getElementById('text').value = ${JSON.stringify(snippet.text)}; document.getElementById('go').click();`);
      for (let i = 0; i < 240 && !await evaluate('!!window.__state'); i++) await delay(50);
      const prediction = await evaluate('window.__state && ({words:__state.words, whole:Array.from(__state.wholeVals)})');
      if (!prediction || prediction.whole.length !== meta.K || prediction.whole.some(v => !Number.isFinite(v))) throw Error('Prediction failed: ' + snippet.id);
      snippet.rscScore = Number(roiWeights.reduce((sum, p) => sum + p.weight * prediction.whole[p.patch], 0).toFixed(6));
      snippet.whole = prediction.whole.map(v => Number(v.toFixed(6)));
    }
    const output = {
      subject: 'UTS03', generatedAt: new Date().toISOString(),
      source: 'Existing GPT-2 layer 8 encoding demo; precomputed predictions, not measured responses from the GCT experiment.',
      scoreMethod: 'Pial-surface-area-weighted mean of reliable unsmoothed patch predictions within the bilateral functional RSC ROI.',
      featureMethod: 'Whole-snippet mean of word-final GPT-2 hidden states, with the original whole-text normalization.',
      units: 'Area-weighted standardized patch prediction; zero is the encoding demo baseline, not an observed neural suppression threshold.',
      corrMin: meta.corr_min, roiVertices, retainedVertices, roiArea, retainedArea, roiWeights,
      sourceSha256: {
        model: sha(path.join(root, '../brain/gpt2_layer8_int8.onnx')),
        weights: sha(path.join(root, '../brain/weights.bin')),
        anatomy: sha(path.join(root, 'brain-surface.bin.gz')),
        roi: sha(path.join(root, 'brain-unfold.bin.gz'))
      }, snippets
    };
    fs.writeFileSync(path.join(root, 'corpus-predictions.json'), JSON.stringify(output));
    const ranked = [...snippets].sort((a, b) => b.rscScore - a.rscScore);
    console.log('Highest:', ranked.slice(0, 8).map(s => [s.text, s.rscScore]));
    console.log('Lowest:', ranked.slice(-5).map(s => [s.text, s.rscScore]));
    console.log('Positive:', snippets.filter(s => s.rscScore > 0).length, 'Negative:', snippets.filter(s => s.rscScore < 0).length);
  } finally { ws.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
