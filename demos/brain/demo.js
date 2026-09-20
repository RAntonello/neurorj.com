import { createBrainView } from './brain-view.js?v=fold-1';
import { createInferenceClient } from './inference-client.js';

const $ = id => document.getElementById(id);
const input = $('text'), status = $('status'), seek = $('pos'), play = $('play');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const inference = createInferenceClient();
const normalized = text => text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const WORD_SECONDS = .35, SIGMA = .34;
let presets, view, state, values, activeExample = null, brainAvailable = false;
let playing = false, whole = true, position = 0, startedAt = 0, frameId = 0, wordIndex = -1;
let requestVersion = 0, inferenceBusy = false, edited = false, loadingExamples = false, loadingBrain = false;
let retryAction = null;
let changingView = false;
const cache = new Map();

function message(text = '', error = false, retry = null) {
  status.textContent = text;
  status.parentElement.classList.toggle('is-error',error);
  retryAction = retry;
  $('retry').hidden = !retry;
}
function validFrame(frame) { return frame?.length === 800 && Array.from(frame).every(Number.isFinite); }
function validateState(result) {
  if (!result.words?.length || result.words.some(word => typeof word !== 'string') ||
      !validFrame(result.wholeVals) || result.wordVals?.length !== result.words.length ||
      !result.wordVals.every(validFrame)) throw Error('The response could not be read. Please try again.');
}
function inputMatches() { return !!state && normalized(input.value) === normalized(state.text); }
function updateControls() {
  $('go').disabled = inferenceBusy;
  const enabled = !!state && !!view && brainAvailable && inputMatches();
  $('response-controls').inert = !enabled;
  document.querySelector('.brain-panel').classList.toggle('is-stale',!!state && !inputMatches());
  play.setAttribute('aria-pressed',String(playing));
  play.setAttribute('aria-label',playing ? 'Pause the response' : 'Play the response');
  play.title = playing ? 'Pause the response' : 'Play the response';
  $('whole').setAttribute('aria-pressed',String(whole));
  $('fold').disabled = !view || !brainAvailable || changingView;
  document.querySelectorAll('.example-button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.example === activeExample && inputMatches())));
}
function stop() {
  playing = false;
  cancelAnimationFrame(frameId); frameId = 0;
  updateControls();
}
function updateReadout(time) {
  const index = Math.min(state.words.length - 1,Math.floor(time / WORD_SECONDS));
  if (index !== wordIndex) {
    wordIndex = index;
    const content = document.createDocumentFragment();
    const context = document.createElement('span');
    context.textContent = state.words.slice(Math.max(0,index-5),index).join(' ');
    if (context.textContent) content.append(context,' ');
    const word = document.createElement('span');
    word.className = 'current-word'; word.textContent = state.words[index];
    content.append(word);
    $('readout').replaceChildren(content);
  }
  $('readout').classList.add('is-visible');
  seek.value = time;
  seek.style.setProperty('--played',`${100 * time / +seek.max}%`);
  seek.setAttribute('aria-valuetext',`Word ${index+1} of ${state.words.length}: ${state.words[index]}`);
}
function paintAt(time) {
  if (!view || !state) return;
  position = clamp(time,0,+seek.max);
  updateReadout(position);
  // Preserve the six-word predictions; blend signed values before coloring,
  // with the same temporal kernel used by the tutorial's display.
  if (reduced.matches) { view.paint(state.wholeVals); return; }
  values.fill(0);
  let total = 0;
  for (let i = 0; i < state.wordVals.length; i++) {
    const distance = (position - (i+.5)*WORD_SECONDS) / SIGMA;
    if (Math.abs(distance) > 3) continue;
    const weight = Math.exp(-.5 * distance * distance);
    total += weight;
    for (let k = 0; k < 800; k++) values[k] += state.wordVals[i][k] * weight;
  }
  if (total > 0) for (let k = 0; k < 800; k++) values[k] /= total;
  view.paint(values);
}
function showWhole() {
  if (!state) return;
  stop(); whole = true; position = 0; wordIndex = -1;
  $('readout').classList.remove('is-visible');
  seek.value = 0; seek.style.setProperty('--played','0%');
  seek.setAttribute('aria-valuetext','Showing the response to the whole text');
  view?.paint(state.wholeVals);
  updateControls();
}
function tick(now) {
  if (!playing) return;
  paintAt((now - startedAt)/1000);
  if (position >= +seek.max) { stop(); return; }
  frameId = requestAnimationFrame(tick);
}
function start() {
  if (!state || !view || !brainAvailable || !inputMatches()) return;
  if (playing) { stop(); return; }
  if (whole || position >= +seek.max) position = 0;
  whole = false; playing = true;
  startedAt = performance.now() - position*1000;
  paintAt(position); updateControls();
  frameId = requestAnimationFrame(tick);
}
function setState(result,text,exampleId = null) {
  validateState(result);
  stop();
  state = { ...result,text };
  // Preserve the read-only prediction exports used by the existing scientific
  // precomputation scripts, without exposing or eagerly loading a model session.
  window.__state = state;
  window.__lastVals = state.wholeVals;
  activeExample = exampleId;
  values = new Float32Array(800);
  seek.max = String(state.words.length*WORD_SECONDS);
  showWhole();
}
function chooseExample(example) {
  ++requestVersion;
  input.value = example.text; edited = false;
  const result = { words:example.words,wordVals:example.frames,wholeVals:example.whole };
  setState(result,example.text,example.id);
  message(inferenceBusy ? 'Preparing the model for your text…' : '');
}
async function prepareBrain() {
  if (loadingBrain || view || !presets) return;
  loadingBrain = true;
  $('view-status').textContent = '';
  $('brain-loading').hidden = false;
  $('brain-loading').textContent = 'Loading brain…';
  $('brain-retry').hidden = true;
  $('brain-visual').setAttribute('aria-busy','true');
  try {
    view = await createBrainView($('brain'),{
      corr:presets.corr,corrMin:presets.corrMin,
      onError(error) {
        brainAvailable = false;
        stop();
        $('brain-loading').textContent = 'The 3D view was interrupted.';
        $('brain-loading').hidden = false;
        $('brain-retry').hidden = false;
        console.error(error);
      }
    });
    brainAvailable = true;
    $('brain-loading').hidden = true;
    $('brain-visual').setAttribute('aria-busy','false');
    if (state) view.paint(state.wholeVals);
    syncViewControl();
    updateControls();
  } catch (error) {
    $('brain-loading').textContent = 'The brain could not load.';
    $('brain-retry').hidden = false;
    console.error(error);
  } finally { loadingBrain = false; }
}
async function loadExamples() {
  if (loadingExamples) return;
  loadingExamples = true;
  message('Loading examples…');
  try {
    const response = await fetch('examples.json');
    if (!response.ok) throw Error('The examples could not load.');
    const data = await response.json();
    if (data.patchCount !== 800 || !validFrame(data.corr) || !Number.isFinite(data.corrMin) || !data.examples?.length) throw Error('The examples could not be read.');
    data.examples.forEach(example => validateState({words:example.words,wordVals:example.frames,wholeVals:example.whole}));
    presets = data;
    window.__dbg = { corr:presets.corr };
    const content = document.createDocumentFragment();
    for (const example of presets.examples) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'example-button';
      button.textContent = example.label; button.dataset.example = example.id;
      button.title = example.text; button.setAttribute('aria-pressed','false');
      button.addEventListener('click',() => chooseExample(example));
      content.append(button);
    }
    $('examples').replaceChildren(content);
    if (!state && !edited) chooseExample(presets.examples[0]);
    else message('');
    await prepareBrain();
  } catch (error) {
    message('The examples could not load. Please try again.',true,loadExamples);
    console.error(error);
  } finally { loadingExamples = false; }
}
async function predict() {
  if (inferenceBusy) return;
  const text = input.value, key = normalized(text);
  if (!key) { message('Add a few words first.'); input.focus(); return; }
  const example = presets?.examples.find(example => normalized(example.text) === key);
  if (example) { chooseExample(example); return; }
  if (cache.has(key)) {
    ++requestVersion;
    setState(cache.get(key),text);
    message(cache.get(key).truncated ? 'Showing the last 1,000 tokens of your text.' : '');
    return;
  }
  const version = ++requestVersion;
  stop(); inferenceBusy = true; updateControls();
  message('Preparing the model for your text…');
  try {
    const result = await inference.predict(text,progress => {
      if (version !== requestVersion) return;
      if (progress.stage === 'running') message('Predicting the response…');
      else if (progress.total && Number.isFinite(progress.loaded)) message(`Loading the model for your text… ${Math.min(100,Math.round(100*progress.loaded/progress.total))}%`);
      else message('Preparing the model for your text…');
    });
    validateState(result);
    cache.set(key,result);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    if (version !== requestVersion || normalized(input.value) !== key) return;
    setState(result,text);
    message(result.truncated ? 'Showing the last 1,000 tokens of your text.' : '');
  } catch (error) {
    if (version === requestVersion) message('The response could not load. Please try again.',true,predict);
    console.error(error);
  } finally {
    inferenceBusy = false; updateControls();
    if (version !== requestVersion) message(inputMatches() ? '' : 'Predict to update the brain.');
  }
}
$('go').addEventListener('click',predict);
input.addEventListener('keydown',event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); predict(); }
});
input.addEventListener('input',() => {
  edited = true; ++requestVersion; stop();
  message(inputMatches() ? '' : 'Predict to update the brain.');
});
$('retry').addEventListener('click',() => retryAction?.());
$('brain-retry').addEventListener('click',() => {
  view?.dispose(); view = null; brainAvailable = false; updateControls(); prepareBrain();
});
$('fold').addEventListener('click',async () => {
  if (!view || !brainAvailable || changingView) return;
  const current = view, unfold = !view.isUnfolded;
  const restoreFocus = document.activeElement === $('fold');
  changingView = true;
  $('view-status').textContent = '';
  $('fold').textContent = unfold ? 'Unfolding…' : 'Folding…';
  updateControls();
  try {
    await current.setUnfolded(unfold);
    if (view !== current) return;
    syncViewControl();
  } catch (error) {
    if (view !== current) return;
    $('view-status').textContent = 'Could not change the view. Try again.';
    syncViewControl();
    console.error(error);
  } finally {
    changingView = false;
    updateControls();
    if (restoreFocus && !$('fold').disabled) $('fold').focus({preventScroll:true});
  }
});
function syncViewControl() {
  const flat = !!view?.isUnfolded;
  $('fold').textContent = flat ? 'Fold' : 'Unfold';
  $('fold').setAttribute('aria-label',flat ? 'Fold the flatmap into a 3D brain' : 'Unfold the brain into a flatmap');
  $('brain-visual').classList.toggle('is-flat',flat);
  $('brain').style.touchAction = flat ? 'pan-y' : 'none';
  $('brain').setAttribute('aria-label',flat
    ? 'Flatmap of both cortical hemispheres showing the predicted response.'
    : '3D brain showing the predicted response. Drag to rotate, use the arrow keys, or press Home to reset the view.');
}
$('brain').addEventListener('webglcontextrestored',() => {
  if (!view) return;
  brainAvailable = true;
  $('brain-loading').hidden = true;
  $('brain-retry').hidden = true;
  $('brain-visual').setAttribute('aria-busy','false');
  updateControls();
});
play.addEventListener('click',start);
$('whole').addEventListener('click',showWhole);
seek.addEventListener('input',() => {
  if (!view || !state || !inputMatches()) return;
  stop(); whole = false; paintAt(+seek.value); updateControls();
});
document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); });
reduced.addEventListener('change',() => { if (state) showWhole(); });
window.addEventListener('pagehide',event => { stop(); if (!event.persisted) { view?.dispose(); inference.dispose(); } });
loadExamples();
