// Predictions use the same encoding model and display smoothing as the snippets.
// Audio time is a playback clock, not an estimate of hemodynamic response timing.
export async function loadParagraphPrediction() {
  const response = await fetch('paragraph-prediction.json');
  if (!response.ok) throw Error('The paragraph prediction could not load.');
  const data = await response.json();
  const text = document.getElementById('generation-text').textContent.trim().replace(/\s+/g, ' ');
  const validFrame = values => Array.isArray(values) && values.length === 800 && values.every(Number.isFinite);
  if (data.text !== text || data.patchCount !== 800 || !validFrame(data.whole) || !validFrame(data.corr)
    || !Number.isFinite(data.corrMin) || !Array.isArray(data.frames) || !data.frames.length
    || !data.frames.every(validFrame) || !Array.isArray(data.centers) || data.centers.length !== data.frames.length
    || data.centers.some((time, i) => !Number.isFinite(time) || time < 0 || (i > 0 && time < data.centers[i - 1]))) {
    throw Error('The paragraph and its prediction do not match.');
  }
  return data;
}

export function connectParagraphResponse(brain, data) {
  const audio = document.getElementById('paragraph-audio');
  const scene = document.getElementById('feedback-scene');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const values = new Float32Array(data.patchCount);
  let frame = 0, lastTime = -1, started = !audio.paused || audio.currentTime > 0;
  const visible = () => scene.getAttribute('aria-hidden') === 'false' && !document.hidden;

  function paint(force = false) {
    if (!visible()) return;
    const time = audio.currentTime;
    if (!force && Math.abs(time - lastTime) < 1 / 60) return;
    lastTime = time;
    if (reduced.matches || !started) { brain.paint(data.whole); return; }
    values.fill(0);
    let total = 0;
    for (let j = 0; j < data.frames.length; j++) {
      const distance = (time - data.centers[j]) / .34;
      if (Math.abs(distance) > 3 && j !== 0 && j !== data.frames.length - 1) continue;
      const weight = Math.exp(-.5 * distance * distance);
      total += weight;
      for (let k = 0; k < values.length; k++) values[k] += data.frames[j][k] * weight;
    }
    if (total > 1e-12) {
      const onset = Math.max(0, Math.min(1, time / .65));
      const scale = onset * onset * (3 - 2 * onset) / total;
      for (let k = 0; k < values.length; k++) values[k] *= scale;
    } else values.set(data.frames[time < data.centers[0] ? 0 : data.frames.length - 1]);
    brain.paint(values);
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function schedule() {
    if (!frame && visible() && !audio.paused && !audio.ended && !reduced.matches) frame = requestAnimationFrame(tick);
  }
  function tick() { frame = 0; paint(); schedule(); }
  function sync() { stop(); paint(true); schedule(); }
  audio.addEventListener('play', () => { started = true; sync(); });
  audio.addEventListener('playing', schedule);
  audio.addEventListener('seeking', () => { started = true; sync(); });
  for (const event of ['pause', 'seeked', 'ended', 'loadedmetadata']) audio.addEventListener(event, sync);
  audio.addEventListener('timeupdate', () => { if (!frame) paint(); });
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  new MutationObserver(sync).observe(scene, { attributes: true, attributeFilter: ['aria-hidden'] });
  sync();
}
