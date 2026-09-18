// Export the existing UTS03 encoding model's predictions for the spoken paragraph.
// First run generate_paragraph_audio.py. Requires Node.js + ws, the site at
// http://127.0.0.1:8877, and an isolated Chrome debugging endpoint:
// GCT_CDP_PORT=9223 node demos/gct/scripts/predict_paragraph.cjs
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const zlib = require('zlib'), WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const json = name => JSON.parse(read(name));
const sha = name => crypto.createHash('sha256').update(read(name)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function rscScores(frames, whole, corr, corrMin) {
  const mesh = zlib.gunzipSync(read('brain-surface.bin.gz'));
  const unfolded = zlib.gunzipSync(read('brain-unfold.bin.gz'));
  const n = mesh.readUInt32LE(4), ni = mesh.readUInt32LE(8);
  const leftCount = unfolded.readUInt32LE(12);
  if (unfolded.readUInt32LE(4) !== n) throw Error('RSC vertex correspondence mismatch.');
  const points = new Float32Array(mesh.buffer, mesh.byteOffset + 16, n * 3);
  const faces = new Uint32Array(mesh.buffer, mesh.byteOffset + 16 + n * 12, ni);
  const labels = new Uint16Array(mesh.buffer, mesh.byteOffset + 16 + n * 12 + ni * 4, n);
  const mask = new Uint8Array(unfolded.buffer, unfolded.byteOffset + 16 + n * 24, n);
  const area = new Float64Array(n);
  for (let i = 0; i < ni; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2];
    const u = [0, 1, 2].map(j => points[b * 3 + j] - points[a * 3 + j]);
    const v = [0, 1, 2].map(j => points[c * 3 + j] - points[a * 3 + j]);
    const share = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 6;
    area[a] += share; area[b] += share; area[c] += share;
  }
  const result = {};
  for (const region of ['bilateral', 'left']) {
    const patchArea = new Float64Array(whole.length);
    let roiVertices = 0, retainedVertices = 0, roiArea = 0, retainedArea = 0;
    for (let i = 0; i < (region === 'left' ? leftCount : n); i++) {
      if (!mask[i]) continue;
      roiVertices++; roiArea += area[i];
      const k = labels[i];
      if (k >= whole.length || corr[k] < corrMin) continue;
      retainedVertices++; retainedArea += area[i]; patchArea[k] += area[i];
    }
    if (!retainedArea) throw Error('No reliable RSC coverage.');
    const patchWeights = Array.from(patchArea, (a, patch) => ({ patch, weight: a / retainedArea })).filter(p => p.weight > 0);
    const score = values => Number(patchWeights.reduce((sum, p) => sum + p.weight * values[p.patch], 0).toFixed(6));
    result[region] = { roiVertices, retainedVertices, roiArea, retainedArea, patchWeights,
      wholeScore: score(whole), frameScores: frames.map(score) };
  }
  return result;
}

async function main() {
  const audio = json('audio/travel-paragraph.json'), meta = json('../brain/meta.json');
  const match = read('index.html').toString().match(/<p\s+id="generation-text">([^<]+)<\/p>/);
  if (!match || match[1].replace(/\s+/g, ' ').trim() !== audio.text) throw Error('Page and audio transcripts differ.');
  if (sha(audio.src) !== audio.sha256) throw Error('Audio timestamps do not belong to this MP3.');
  const text = audio.text, modelText = normalize(text);
  const expectedWords = modelText.split(' ');
  if (audio.words.length !== expectedWords.length || audio.words.some((w, i) => normalize(w.word) !== expectedWords[i])) {
    throw Error('The model words do not align one-to-one with the spoken words.');
  }
  const centers = audio.words.map(w => Number(((w.start + w.end) / 2).toFixed(4)));
  if (audio.words.some((w, i) => !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end < w.start || w.end > audio.duration || (i && centers[i] <= centers[i - 1]))) {
    throw Error('Invalid or nonmonotonic audio timing.');
  }
  const tabs = await (await fetch(`http://127.0.0.1:${process.env.GCT_CDP_PORT || 9223}/json`)).json();
  const tab = tabs.find(t => t.url.includes('/demos/brain/')) || tabs.find(t => t.type === 'page');
  if (!tab) throw Error('No inference browser tab.');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  let seq = 0; const pending = new Map();
  ws.on('message', bytes => {
    const message = JSON.parse(bytes); if (!message.id) return;
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
    if (!await evaluate('!!window.__dbg')) throw Error('Encoding model did not load.');
    await evaluate(`window.__state = null; document.getElementById('text').value = ${JSON.stringify(modelText)}; document.getElementById('go').click();`);
    for (let i = 0; i < 240 && !await evaluate('!!window.__state'); i++) await delay(100);
    const prediction = await evaluate('window.__state && ({words:__state.words,frames:__state.wordVals.map(v=>Array.from(v)),whole:Array.from(__state.wholeVals),corr:Array.from(__dbg.corr),tokenCount:__state.ntok})');
    if (!prediction || JSON.stringify(prediction.words) !== JSON.stringify(expectedWords)) throw Error('Inference word mismatch.');
    if (prediction.frames.length !== centers.length || prediction.corr.length !== meta.K || prediction.corr.some(x => !Number.isFinite(x)) || [prediction.whole, ...prediction.frames].some(v => v.length !== meta.K || v.some(x => !Number.isFinite(x)))) {
      throw Error('Missing or invalid model outputs.');
    }
    const rsc = rscScores(prediction.frames, prediction.whole, prediction.corr, meta.corr_min);
    const round = values => values.map(v => Number(v.toFixed(4)));
    const output = {
      subject: 'UTS03', generatedAt: new Date().toISOString(),
      source: 'Existing GPT-2 layer 8 encoding demo; model predictions for this tutorial paragraph, not measured in vivo responses.',
      text, modelText, words: prediction.words, tokenCount: prediction.tokenCount,
      preprocessing: 'Unicode NFD accent transliteration (São to Sao), then the unchanged demo lowercase/ASCII punctuation normalization. Displayed and spoken text retain their original accents.',
      featureMethod: 'Mean of trailing six word-final GPT-2 hidden states (fewer at the start) with the original window normalization; whole-text map uses original whole-text normalization.',
      timingMethod: 'Frame centers are spoken-word midpoint timestamps from Kokoro. Audio alignment is illustrative, not a simulation of fMRI hemodynamic timing.',
      windowWords: 6, patchCount: meta.K, corrMin: meta.corr_min,
      corr: prediction.corr.map(v => Number(v.toFixed(5))),
      frames: prediction.frames.map(round), whole: round(prediction.whole), centers, audio,
      rscScoreMethod: 'Pial-surface-area-weighted mean of unsmoothed reliable patch predictions within the existing functional RSC mask. Standardized model units; zero is not a measured suppression threshold.',
      rsc,
      sourceSha256: {
        model: sha('../brain/gpt2_layer8_int8.onnx'), weights: sha('../brain/weights.bin'),
        inference: sha('../brain/demo.js'), tokenizer: sha('../brain/tokenizer.js'),
        tokenizerVocab: sha('../brain/tokenizer/vocab.json'), tokenizerMerges: sha('../brain/tokenizer/merges.txt'),
        anatomy: sha('brain-surface.bin.gz'), roi: sha('brain-unfold.bin.gz'),
        audio: sha(audio.src), audioTimings: sha('audio/travel-paragraph.json'),
      },
    };
    const target = path.join(root, 'paragraph-prediction.json');
    fs.writeFileSync(target, JSON.stringify(output));
    console.log('Saved', target, fs.statSync(target).size, 'bytes;', output.words.length, 'word frames.');
    for (const [region, scores] of Object.entries(rsc)) console.log(region, {
      whole: scores.wholeScore, minFrame: Math.min(...scores.frameScores), maxFrame: Math.max(...scores.frameScores),
      positiveFrames: scores.frameScores.filter(v => v > 0).length, totalFrames: scores.frameScores.length,
      retainedPercent: 100 * scores.retainedArea / scores.roiArea,
    });
  } finally { ws.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
