(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cloud = $('snippet-cloud'), target = $('drop-zone'), audio = $('snippet-audio');
  const panels = [$('opening'), $('playground'), $('black-box-panel'), $('rsc-panel'), $('corpus-panel'), $('ranking-panel'), $('location-panel'), $('llm-panel'), $('candidate-panel'), $('generation-panel'), $('feedback-panel'), $('paper-panel')], model = $('shared-model'), stage = document.querySelector('.stage');
  const brainSide = model.querySelector('.brain-side');
  const panelStops = [0, 1.8, 3.2, 4.6, 5.9, 7.2, 8.5, 10.2, 11.7, 13.2, 14.7, 16.2];
  const clamp = v => Math.max(0, Math.min(1, v));
  let progress = 0, selectedPanel = 0, scrollQueued = false;
  let rscBlend = 0, corpusBlend = 0, rankBlend = 0, llmBlend = 0, candidateBlend = 0, generationBlend = 0, feedbackBlend = 0, closingBlend = 0, corpusOffset = { x: 0, y: 0, rankY: 0 };
  let rscLayout = { x: 0, y: 0, baseWidth: 0, baseHeight: 0, width: 0, height: 0 };
  let data, clips, brain, active, pending, ready = false, loading = false;
  let feedbackBrain, feedbackLoading = false, feedbackError = false;
  let raf = 0, playRequest = 0, lastPaintTime = -1, wordIndex = -1;
  let shown;
  const audioCache = new Map();

  function syncEncodingSignals() {
    model.classList.toggle('is-signaling', progress < 2.6 && !reduced.matches && !document.hidden);
  }

  function setControls() {
    const playing = !audio.paused && !audio.ended;
    $('play-pause').textContent = playing ? 'Ⅱ' : '▷';
    $('play-pause').setAttribute('aria-label', playing ? 'Pause audio and animation' : 'Play audio and animation');
    $('play-pause').title = playing ? 'Pause' : 'Play';
    $('mute-audio').setAttribute('aria-pressed', String(audio.muted));
    $('mute-audio').title = audio.muted ? 'Unmute audio' : 'Mute audio';
    $('mute-audio').setAttribute('aria-label', $('mute-audio').title);
    model.classList.toggle('is-playing', playing);
    $('hero-play').setAttribute('aria-label', playing ? 'Pause the spoken example' : 'Play the spoken example');
  }
  function renderScroll() {
    // Viewport units preserve the opening's pacing as more panels are added.
    progress = Math.max(0, scrollY / Math.max(1, stage.offsetHeight));
    const blend = clamp((progress - .93) / .38);
    const boxBlend = clamp((progress - 2.2) / .4);
    rscBlend = clamp((progress - 3.5) / .8);
    corpusBlend = clamp((progress - 4.95) / .6);
    rankBlend = clamp((progress - 6.25) / .65);
    const locationBlend = clamp((progress - 7.55) / .65);
    llmBlend = clamp((progress - 8.85) / 1.15);
    candidateBlend = clamp((progress - 10.65) / .8);
    generationBlend = clamp((progress - 12.05) / .9);
    feedbackBlend = clamp((progress - 13.55) / .95);
    closingBlend = clamp((progress - 15.05) / .85);
    const closingOut = 1 - clamp(closingBlend / .45);
    const llmContextOpacity = 1 - clamp(candidateBlend / .45);
    panels[0].style.opacity = 1 - blend;
    panels[1].style.opacity = blend * (1 - boxBlend);
    panels[2].style.opacity = clamp((progress - 2.6) / .35) * (1 - clamp(rscBlend / .45));
    panels[3].style.opacity = clamp((rscBlend - .45) / .55) * (1 - corpusBlend);
    panels[4].style.opacity = corpusBlend * (1 - clamp(rankBlend / .42));
    panels[5].style.opacity = clamp((rankBlend - .58) / .42) * (1 - clamp(locationBlend / .42));
    panels[6].style.opacity = clamp((locationBlend - .42) / .58) * (1 - clamp(llmBlend / .4));
    panels[7].style.opacity = clamp((llmBlend - .4) / .45) * llmContextOpacity;
    panels[8].style.opacity = clamp((candidateBlend - .35) / .55) * (1 - clamp(generationBlend / .4));
    panels[9].style.opacity = clamp((generationBlend - .4) / .5) * (1 - clamp(feedbackBlend / .4));
    panels[10].style.opacity = clamp((feedbackBlend - .4) / .5) * closingOut;
    panels[11].style.opacity = clamp((closingBlend - .45) / .55);
    stage.style.setProperty('--corpus-opacity', corpusBlend * llmContextOpacity);
    stage.style.setProperty('--rank-progress', rankBlend);
    stage.style.setProperty('--location-progress', reduced.matches ? Number(locationBlend >= .5) : locationBlend * locationBlend * (3 - 2 * locationBlend));
    stage.style.setProperty('--encoding-box-opacity', 1 - clamp(llmBlend / .4));
    stage.style.setProperty('--llm-opacity', clamp((llmBlend - .35) / .4) * closingOut);
    stage.style.setProperty('--llm-context-opacity', llmContextOpacity);
    stage.style.setProperty('--llm-output-opacity', clamp((llmBlend - .8) / .2));
    stage.style.setProperty('--generation-opacity', clamp((generationBlend - .3) / .55) * closingOut);
    stage.style.setProperty('--generation-input-opacity', clamp((generationBlend - .6) / .3));
    stage.style.setProperty('--stimulus-opacity', clamp((generationBlend - .65) / .35));
    stage.style.setProperty('--generation-context-opacity', 1 - clamp(feedbackBlend / .35));
    stage.style.setProperty('--feedback-opacity', clamp((feedbackBlend - .4) / .5) * closingOut);
    positionDiagram();
    stage.style.setProperty('--context-opacity', 1 - boxBlend);
    stage.style.setProperty('--brain-opacity', 1 - corpusBlend);
    $('model-description').style.opacity = clamp((progress - .0475) / .437);
    // The scroll cue clears before the opening's lower text appears.
    const showScrollCue = progress < .045;
    $('next').style.opacity = 1 - clamp(progress / .045);
    $('next').inert = !showScrollCue;
    $('next').setAttribute('aria-hidden', String(!showScrollCue));
    const nextPanel = closingBlend >= .5 ? 11 : feedbackBlend >= .5 ? 10 : generationBlend >= .5 ? 9 : candidateBlend >= .5 ? 8 : llmBlend >= .5 ? 7 : locationBlend >= .5 ? 6 : rankBlend >= .5 ? 5 : corpusBlend >= .5 ? 4 : rscBlend >= .5 ? 3 : boxBlend >= .5 ? 2 : blend >= .5 ? 1 : 0;
    if (nextPanel >= 2 && selectedPanel < 2) {
      pending = null; ++playRequest; audio.pause(); cleanup();
    }
    [$('hero-play'), $('playback-controls')].forEach(element => {
      element.inert = nextPanel >= 2;
      element.setAttribute('aria-hidden', String(nextPanel >= 2));
      element.style.pointerEvents = nextPanel >= 2 ? 'none' : '';
    });
    brainSide.inert = nextPanel >= 4;
    brainSide.setAttribute('aria-hidden', String(nextPanel >= 4));
    brainSide.style.pointerEvents = nextPanel <= 2 ? 'auto' : 'none';
    $('response-brain').tabIndex = nextPanel <= 2 ? 0 : -1;
    model.style.pointerEvents = nextPanel >= 2 ? 'none' : '';
    target.setAttribute('aria-label', nextPanel >= 2 ? 'Black-box language encoding model' : 'Drop a snippet into the encoding model');
    corpus.setActive(nextPanel === 4 && rankBlend === 0);
    corpus.rank(rankBlend);
    target.inert = nextPanel >= 7;
    target.setAttribute('aria-hidden', String(nextPanel >= 7));
    $('llm-scene').inert = nextPanel < 7 || nextPanel === 11;
    $('llm-scene').setAttribute('aria-hidden', String(nextPanel < 7 || nextPanel === 11));
    $('llm-scene').setAttribute('aria-label', nextPanel >= 8 ? 'Candidate explanation for RSC.' : 'The ten highest-ranked snippets feed into an LLM, which summarizes their common pattern.');
    [$('llm-node'), $('llm-prompt')].forEach(element => {
      element.inert = nextPanel !== 7;
      element.setAttribute('aria-hidden', String(nextPanel !== 7));
    });
    $('corpus-scene').inert = nextPanel < 4 || nextPanel >= 8;
    $('corpus-scene').setAttribute('aria-hidden', String(nextPanel < 4 || nextPanel >= 8));
    $('generation-scene').inert = nextPanel < 9 || nextPanel === 11;
    $('generation-scene').setAttribute('aria-hidden', String(nextPanel < 9 || nextPanel === 11));
    $('generation-scene').setAttribute('aria-label', nextPanel === 10 ? 'A paragraph generated from the travel and location names hypothesis.' : 'An LLM uses the candidate explanation as a theme to generate a paragraph.');
    [$('generation-node'), $('generation-prompt')].forEach(element => {
      element.inert = nextPanel !== 9;
      element.setAttribute('aria-hidden', String(nextPanel !== 9));
    });
    $('feedback-scene').inert = nextPanel !== 10;
    $('feedback-scene').setAttribute('aria-hidden', String(nextPanel !== 10));
    $('feedback-brain').tabIndex = nextPanel === 10 ? 0 : -1;
    if (feedbackBrain) feedbackBrain.controls.enabled = nextPanel === 10;
    if (feedbackBlend > 0 && closingBlend < .5 && ready) ensureFeedbackBrain();
    panels.forEach((panel, i) => {
      panel.inert = i !== nextPanel;
      panel.setAttribute('aria-hidden', String(i !== nextPanel));
      panel.style.pointerEvents = i === nextPanel ? 'auto' : 'none';
    });
    document.querySelectorAll('[data-panel]').forEach((b, i) => {
      if (i === nextPanel) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    selectedPanel = nextPanel; scrollQueued = false;
    syncEncodingSignals();
    syncBrainPresentation();
  }
  function positionDiagram() {
    const amount = reduced.matches ? Number(corpusBlend >= .5) : corpusBlend * corpusBlend * (3 - 2 * corpusBlend);
    const unfolding = reduced.matches ? Number(rscBlend >= .5) : rscBlend * rscBlend * (3 - 2 * rscBlend);
    const ranking = reduced.matches ? Number(rankBlend >= .5) : rankBlend * rankBlend * (3 - 2 * rankBlend);
    const corpusY = corpusOffset.y + (corpusOffset.rankY - corpusOffset.y) * ranking;
    stage.style.setProperty('--box-shift-x', `${rscLayout.x * unfolding * (1 - amount) + corpusOffset.x * amount}px`);
    stage.style.setProperty('--box-shift-y', `${rscLayout.y * unfolding * (1 - amount) + corpusY * amount}px`);
    if (rscLayout.baseWidth) {
      stage.style.setProperty('--brain-width', `${rscLayout.baseWidth + (rscLayout.width - rscLayout.baseWidth) * unfolding}px`);
      stage.style.setProperty('--brain-height', `${rscLayout.baseHeight + (rscLayout.height - rscLayout.baseHeight) * unfolding}px`);
      stage.style.setProperty('--brain-shift-y', `${rscLayout.y * unfolding}px`);
    }
    stage.style.setProperty('--rsc-label-opacity', clamp((rscBlend - .8) / .2));
  }
  function syncBrainPresentation() {
    if (!brain) return;
    const amount = reduced.matches ? Number(rscBlend >= .5) : rscBlend;
    brain.setUnfold(amount, reduced.matches ? amount : clamp((rscBlend - .2) / .8));
    if (amount > 0) $('response-brain').setAttribute('aria-label', 'Cortical surface unfolding into a flatmap, with retrosplenial cortex highlighted in both hemispheres.');
    else $('response-brain').setAttribute('aria-label', 'Rotatable 3D brain showing the model’s prediction. Drag or use arrow keys to rotate. Home resets the view.');
  }
  function updateRscAnnotation(points) {
    const width = $('response-brain').clientWidth, height = $('response-brain').clientHeight;
    $('rsc-overlay').setAttribute('viewBox', `0 0 ${width} ${height}`);
    const labelY = Math.max(14, Math.min(points[0].y, points[1].y) - 34);
    $('rsc-label').setAttribute('x', width / 2); $('rsc-label').setAttribute('y', labelY);
    points.forEach((point, i) => {
      const startX = width / 2 + (i ? 10 : -10);
      $(i ? 'rsc-leader-right' : 'rsc-leader-left').setAttribute('d', `M${startX},${labelY + 5} Q${startX},${point.y - 12} ${point.x},${point.y}`);
    });
  }
  function queueScroll() { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(renderScroll); } }
  function goTo(position) {
    window.scrollTo({ top: stage.offsetHeight * position, behavior: reduced.matches ? 'instant' : 'smooth' });
  }
  addEventListener('scroll', queueScroll, { passive: true }); addEventListener('resize', queueScroll);
  $('next').addEventListener('click', () => goTo(progress < .57 ? .665 : panelStops[1]));
  document.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => goTo(panelStops[Number(b.dataset.panel)])));

  async function json(path) {
    const r = await fetch(path); if (!r.ok) throw Error(`Could not load ${path}`); return r.json();
  }
  function audioURL(path) {
    if (!audioCache.has(path)) audioCache.set(path, (async () => {
      const r = await fetch(path); if (!r.ok) throw Error(`Could not load ${path}`);
      // Local blobs support accurate seeking even on static preview servers
      // that do not implement HTTP byte ranges. All ten clips total <700 KB.
      return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'audio/mpeg' }));
    })().catch(e => { audioCache.delete(path); throw e; }));
    return audioCache.get(path);
  }
  async function initialize() {
    if (loading) return;
    loading = true; $('load-error').hidden = true;
    $('model-status').textContent = 'Loading the brain…';
    try {
      const module = await import('./brain3d.js');
      const [geometry, modelData, timingData, corpusData] = await Promise.all([
        module.loadSurface(), json('predictions.json'), json('audio/timings.json'), json('corpus-predictions.json')
      ]);
      data = modelData; clips = timingData;
      corpus.setScores(corpusData);
      await Promise.all(Object.values(clips).map(async clip => { clip.url = await audioURL(clip.src); }));
      for (const s of data.snippets) {
        const clip = clips[s.id];
        if (!clip || clip.words.length !== s.words.length) throw Error('Audio and model words do not match.');
        if (clip.words.some((w, i) => w.word.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '') !== s.words[i])) throw Error('Audio transcript does not match the model prediction.');
        s.centers = clip.words.map(w => (w.start + w.end) / 2);
        const b = cloud.querySelector(`[data-snippet="${s.id}"]`);
        b.setAttribute('aria-label', `Play: ${s.text}`); b.title = s.text;
      }
      brain?.dispose();
      brain = new module.BrainView($('response-brain'), geometry, data);
      brain.onRender = updateRscAnnotation;
      brain.paint(data.snippets.find(s => s.id === 'places').whole);
      syncBrainPresentation();
      shown = new Float32Array(data.patchCount);
      ready = true; $('model-status').textContent = 'The model is ready.';
      if (feedbackBlend > 0 && closingBlend < .5) ensureFeedbackBrain();
      audio.src = clips.places.url;
      if (pending) { const selection = pending; pending = null; selectSnippet(selection); }
    } catch (e) {
      $('error-message').textContent = 'The demo could not load. Please retry.';
      $('model-status').textContent = $('error-message').textContent;
      $('load-error').hidden = false; console.error(e);
    } finally { loading = false; }
  }
  $('retry').addEventListener('click', () => {
    if (feedbackError) { feedbackError = false; ensureFeedbackBrain(); }
    else if (ready && active) selectSnippet(active.snippet.id); else initialize();
  });

  async function ensureFeedbackBrain() {
    if (feedbackBrain || feedbackLoading || feedbackError) return;
    feedbackLoading = true;
    try {
      const { createFeedbackBrain } = await import('./feedback-brain.js');
      feedbackBrain = await createFeedbackBrain($('feedback-brain'), point => {
        const width = $('feedback-brain').clientWidth, height = $('feedback-brain').clientHeight;
        const labelX = Math.max(22, Math.min(width - 30, point.x - 28));
        const labelY = Math.max(16, point.y - 34);
        $('feedback-rsc').setAttribute('viewBox', `0 0 ${width} ${height}`);
        $('feedback-rsc-label').setAttribute('x', labelX);
        $('feedback-rsc-label').setAttribute('y', labelY);
        $('feedback-rsc-leader').setAttribute('d', `M${labelX + 10},${labelY + 5} L${point.x},${point.y}`);
      });
      feedbackBrain.controls.enabled = selectedPanel === 10;
      $('feedback-brain').dataset.ready = 'true';
      $('load-error').hidden = true;
    } catch (error) {
      feedbackError = true;
      $('error-message').textContent = 'The feedback brain could not load. Please retry.';
      $('load-error').hidden = false; console.error(error);
    } finally { feedbackLoading = false; }
  }

  // A continuous temporal kernel replaces the old step/hold word animation.
  // Audio time is the only playback clock, including pause, seek and buffering.
  function paintAt(time, force = false) {
    if (!active) return;
    const { snippet: s, clip } = active;
    if (!force && Math.abs(time - lastPaintTime) < 1 / 60) return;
    lastPaintTime = time;
    $('word-position').value = time;
    let index = 0;
    while (index + 1 < clip.words.length && clip.words[index + 1].start <= time) index++;
    if (index !== wordIndex || force) {
      wordIndex = index;
      $('word-position').setAttribute('aria-valuetext', `${clip.words[index].word}, ${time.toFixed(1)} seconds`);
      const canvas = $('response-brain');
      canvas.setAttribute('aria-label', `Rotatable 3D brain predicting the response to “${s.words.slice(Math.max(0, index - 5), index + 1).join(' ')}”. Drag or use arrow keys to rotate.`);
    }
    if (reduced.matches) { if (force) brain.paint(s.whole); return; }
    shown.fill(0); let total = 0;
    const sigma = .34;
    for (let j = 0; j < s.frames.length; j++) {
      const d = (time - s.centers[j]) / sigma;
      if (Math.abs(d) > 3 && j !== 0 && j !== s.frames.length - 1) continue;
      const w = Math.exp(-.5 * d * d);
      total += w;
      for (let k = 0; k < shown.length; k++) shown[k] += s.frames[j][k] * w;
    }
    if (total > 1e-12) {
      const t = clamp(time / .65), onset = t * t * (3 - 2 * t);
      for (let k = 0; k < shown.length; k++) shown[k] *= onset / total;
    } else shown.set(s.frames[time < s.centers[0] ? 0 : s.frames.length - 1]);
    brain.paint(shown);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0; paintAt(audio.currentTime);
    if (!audio.paused && !audio.ended && !document.hidden) schedule();
  }
  function playAudio() {
    const request = ++playRequest;
    const promise = audio.play();
    promise?.catch(e => {
      if (request !== playRequest || e.name === 'AbortError') return;
      setControls();
      if (e.name === 'NotAllowedError') $('model-status').textContent = 'Press play to hear the selected snippet.';
      else {
        $('error-message').textContent = 'The audio could not play. Please retry.';
        $('load-error').hidden = false;
      }
    });
  }
  function selectSnippet(id) {
    if (selectedPanel >= 2) return;
    if (!ready) { pending = id; $('model-status').textContent = 'Loading the selected snippet…'; return; }
    const s = data.snippets.find(s => s.id === id); if (!s) return;
    audio.pause(); ++playRequest;
    active = { snippet: s, clip: clips[id] };
    wordIndex = -1; lastPaintTime = -1;
    $('load-error').hidden = true;
    audio.src = active.clip.url; audio.dataset.snippet = id;
    $('hero-play').querySelector('.example-copy').textContent = `“${s.text}”`;
    $('hero-play').title = s.text;
    $('playback-controls').hidden = false; $('word-position').max = active.clip.duration;
    cloud.querySelectorAll('.snippet').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.snippet === id)));
    target.classList.remove('accepted'); void target.offsetWidth; target.classList.add('accepted');
    paintAt(0, true); playAudio();
    $('model-status').textContent = `Playing: ${s.text}`;
  }
  function togglePlayback() {
    if (!active) return;
    if (!audio.paused) audio.pause();
    else { if (audio.ended) audio.currentTime = 0; playAudio(); }
  }
  $('hero-play').addEventListener('click', () => {
    if (active) togglePlayback(); else selectSnippet('places');
  });
  $('play-pause').addEventListener('click', () => {
    togglePlayback();
  });
  $('mute-audio').addEventListener('click', () => {
    audio.muted = !audio.muted; setControls();
  });
  audio.addEventListener('volumechange', setControls);
  $('replay').addEventListener('click', () => {
    if (!active) return;
    audio.currentTime = 0; paintAt(0, true); playAudio();
  });
  $('word-position').addEventListener('input', () => {
    if (!active) return;
    audio.pause(); audio.currentTime = Number($('word-position').value); paintAt(audio.currentTime, true);
  });
  audio.addEventListener('play', () => { setControls(); schedule(); });
  audio.addEventListener('playing', schedule);
  audio.addEventListener('pause', () => { setControls(); paintAt(audio.currentTime, true); });
  audio.addEventListener('seeked', () => paintAt(audio.currentTime, true));
  audio.addEventListener('durationchange', () => { if (active && Number.isFinite(audio.duration)) $('word-position').max = audio.duration; });
  audio.addEventListener('ended', () => { paintAt(audio.currentTime, true); setControls(); $('model-status').textContent = 'Playback complete.'; });
  audio.addEventListener('error', () => {
    if (!active) return;
    $('error-message').textContent = 'The audio could not load. Please retry.';
    $('load-error').hidden = false;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); syncEncodingSignals(); });
  reduced.addEventListener('change', () => { if (active) paintAt(audio.currentTime, true); });
  let drag, ignoreClickUntil = 0;
  function cleanup() {
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost?.remove(); d.button.classList.remove('drag-source');
    if (d.button.hasPointerCapture(d.id)) d.button.releasePointerCapture(d.id);
    document.body.classList.remove('is-dragging'); target.classList.remove('is-over');
  }
  cloud.querySelectorAll('.snippet').forEach(button => {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { if (performance.now() >= ignoreClickUntil) selectSnippet(button.dataset.snippet); });
    button.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      drag = { button, id: e.pointerId, x: e.clientX, y: e.clientY };
      button.setPointerCapture(e.pointerId);
    });
  });
  addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.ghost) {
      drag.ghost = document.createElement('div'); drag.ghost.className = 'drag-ghost';
      drag.ghost.textContent = drag.button.textContent; drag.ghost.setAttribute('aria-hidden', 'true'); document.body.append(drag.ghost);
      document.body.classList.add('is-dragging'); drag.button.classList.add('drag-source');
    }
    drag.ghost.style.left = `${e.clientX + 12}px`; drag.ghost.style.top = `${e.clientY - 25}px`;
    const r = target.getBoundingClientRect(); drag.over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    target.classList.toggle('is-over', drag.over);
  });
  addEventListener('pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = !!drag.ghost, accepted = drag.over, id = drag.button.dataset.snippet;
    if (moved) ignoreClickUntil = performance.now() + 400;
    cleanup(); if (moved && accepted) selectSnippet(id);
  });
  addEventListener('pointercancel', cleanup); addEventListener('blur', cleanup);
  addEventListener('keydown', e => { if (e.key === 'Escape') cleanup(); });

  function drawLlmNetwork(svg, outputTraces) {
    const element = (tag, attributes, parent = svg) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      parent.append(node); return node;
    };
    const point = (layer, column, row) => ({ x: 25 + layer * 67 + column * 14, y: 64 - layer * 6 + row * 30 - column * 8 });
    const line = (a, b) => `M${a.x},${a.y} L${b.x},${b.y}`;
    // A schematic of information passing through layers, not model weights.
    const edges = [];
    for (let layer = 0; layer < 2; layer++) {
      for (let row = 0; row < 4; row++) {
        for (const next of [row, (row + 1) % 4]) edges.push(line(point(layer, 2, row), point(layer + 1, 0, next)));
      }
    }
    for (const row of [0, 1, 2, 3]) {
      edges.push(line({ x: 8, y: 100 }, point(0, 0, row)));
      edges.push(line(point(2, 2, row), { x: 212, y: 100 }));
    }
    element('path', { class: 'llm-network-edge', d: edges.join(' ') });
    for (let layer = 0; layer < 3; layer++) {
      const group = element('g', { class: 'llm-network-layer', style: `--network-delay:${1.9 + layer * .65}s` });
      const x = 25 + layer * 67, y = 64 - layer * 6;
      element('path', { class: 'llm-network-plane', d: `M${x - 11},${y - 4} L${x + 39},${y - 32} L${x + 39},${y + 83} L${x - 11},${y + 111}Z` }, group);
      const grid = [];
      for (let row = 0; row < 4; row++) grid.push(line(point(layer, 0, row), point(layer, 2, row)));
      for (let column = 0; column < 3; column++) grid.push(line(point(layer, column, 0), point(layer, column, 3)));
      element('path', { class: 'llm-network-grid', d: grid.join(' ') }, group);
      for (let row = 0; row < 4; row++) for (let column = 0; column < 3; column++) {
        const p = point(layer, column, row);
        element('circle', { class: 'llm-network-dot', cx: p.x, cy: p.y, r: 2.2 }, group);
        element('circle', { class: 'llm-network-activation', cx: p.x, cy: p.y, r: 2.6 }, group);
      }
    }
    for (let row = 0; row < 3; row++) {
      const points = [{ x: 8, y: 100 }];
      for (let layer = 0; layer < 3; layer++) {
        const r = (row + layer) % 4;
        points.push(point(layer, 0, r), point(layer, 2, r));
      }
      points.push({ x: 212, y: 100 });
      element('path', {
        class: 'llm-network-pulse', pathLength: 100,
        d: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '),
        style: `--network-delay:${1.65 + row * .55}s`
      });
      // Network pulses reach the exit at 40% of their 6.5-second cycle;
      // connector pulses begin at 12%. Offset their delays for the handoff.
      element('path', {
        class: 'llm-trace llm-connector-trace', pathLength: 100,
        style: `--read-delay:${1.65 + row * .55 + (.4 - .12) * 6.5}s`
      }, outputTraces);
    }
  }

  // Keep the same elements through the cloud-to-ranking transition. Scores are
  // precomputed model predictions over the highlighted RSC ROI, not topic tags.
  function createCorpus() {
    drawLlmNetwork($('llm-network'), $('llm-output-traces'));
    drawLlmNetwork($('generation-network'), $('generation-output-traces'));
    const scene = $('corpus-scene'), source = $('corpus-cloud'), stream = $('corpus-stream');
    const entries = [...source.querySelectorAll('[data-corpus-id]')];
    const cloudLabel = source.getAttribute('aria-label');
    const sizes = [.9, 1.1, 1, .95, 1.2, 1.05, .85, 1.15];
    // Editorial annotations identify place words in the existing snippets.
    // They do not affect prediction scores, ranking, or the original text.
    const locationTerms = /\b(town square|way home|lake|bridge|station|path|woods|harbor|hall|library|hills|bakery|riverbank|courtyard|room|garden)\b/g;
    entries.forEach((entry, i) => {
      entry.className = `corpus-snippet s${i % 10 + 1}`;
      entry.classList.toggle('mobile-extra', i >= 32);
      entry.classList.toggle('tiny-extra', i >= 28);
      entry.setAttribute('aria-hidden', 'true');
      entry.style.setProperty('--size', sizes[i % sizes.length]);
      entry.style.setProperty('--drift-duration', `${9 + i % 7}s`);
      entry.style.setProperty('--drift-delay', `${-i * 1.7}s`);
      entry.style.setProperty('--drift-x', `${2 + i % 3}px`);
      entry.style.setProperty('--drift-y', `${i % 2 ? 3 : -3}px`);
      if (entry.dataset.topic === 'location') {
        const text = entry.textContent, parts = []; let end = 0;
        for (const match of text.matchAll(locationTerms)) {
          parts.push(document.createTextNode(text.slice(end, match.index)));
          const word = document.createElement('span'); word.className = 'location-word'; word.textContent = match[0];
          parts.push(word); end = match.index + match[0].length;
        }
        parts.push(document.createTextNode(text.slice(end)));
        entry.replaceChildren(...parts);
      }
    });
    let visible = [], flights = [], cursor = 0, untilNext = 0, isActive = false;
    let sorted, geometry, startPositions, requestedRank = 0;
    let llmConnections = [];
    let outputShift = { x: 0, y: 0 };
    const scoreById = new Map(), rankById = new Map();
    let positiveMax = 1, negativeMax = 1;
    const mix = (a, b, t) => a + (b - a) * t;
    function responseColor(score) {
      const neutral = [112, 112, 112], extreme = score >= 0 ? [179, 49, 56] : [39, 100, 159];
      const strength = clamp(Math.abs(score) / (score >= 0 ? positiveMax : negativeMax));
      return neutral.map((value, i) => mix(value, extreme[i], strength));
    }
    function setScores(predictions) {
      const records = new Map(predictions.snippets.map(snippet => [snippet.id, snippet]));
      if (records.size !== entries.length || entries.some(entry => {
        const record = records.get(entry.dataset.corpusId);
        return !record || record.text !== entry.textContent.trim() || !Number.isFinite(record.rscScore);
      })) throw Error('RSC predictions do not match the snippet corpus.');
      entries.forEach(entry => {
        const score = records.get(entry.dataset.corpusId).rscScore;
        scoreById.set(entry.dataset.corpusId, score);
        entry.dataset.rscScore = score;
      });
      sorted = [...entries].sort((a, b) => scoreById.get(b.dataset.corpusId) - scoreById.get(a.dataset.corpusId));
      sorted.forEach((entry, i) => {
        rankById.set(entry.dataset.corpusId, i + 1);
        entry.dataset.rank = i + 1;
        entry.classList.toggle('llm-input', i < 10);
        entry.style.setProperty('--read-delay', `${i * .32}s`);
      });
      $('llm-input-links').replaceChildren();
      llmConnections = sorted.slice(0, 10).map((entry, i) => {
        const wire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        wire.classList.add('llm-wire');
        const trace = wire.cloneNode(); trace.setAttribute('class', 'llm-trace');
        trace.setAttribute('pathLength', '100'); trace.style.setProperty('--read-delay', `${i * .32}s`);
        $('llm-input-links').append(wire, trace);
        return { entry, wire, trace };
      });
      positiveMax = Math.max(...scoreById.values(), 0) || 1;
      negativeMax = Math.abs(Math.min(...scoreById.values(), 0)) || 1;
      layoutScene();
    }
    function reset() {
      flights.forEach(flight => { flight.node.remove(); flight.entry.classList.remove('is-in-flight'); });
      flights = []; untilNext = 0;
    }
    function setActive(value) {
      if (value === isActive) return;
      isActive = value;
      scene.classList.toggle('is-active', value);
      if (!value) reset();
    }
    function restoreCloud() {
      if (!source.classList.contains('is-ranking')) return;
      source.classList.remove('is-ranking', 'is-reading');
      source.style.height = ''; source.style.overflow = ''; source.scrollTop = 0;
      source.removeAttribute('tabindex');
      source.setAttribute('role', 'img'); source.setAttribute('aria-label', cloudLabel);
      source.append(...entries);
      entries.forEach(entry => {
        entry.style.transform = ''; entry.style.fontSize = ''; entry.style.color = '';
        entry.style.opacity = ''; entry.style.visibility = '';
        entry.setAttribute('aria-hidden', 'true');
        for (const attribute of ['role', 'aria-label', 'aria-posinset', 'aria-setsize', 'title']) entry.removeAttribute(attribute);
      });
      startPositions = null;
    }
    function layout(baseCenter) {
      reset(); restoreCloud();
      // Measure the original output typography before deriving the later input.
      $('llm-explanation').style.removeProperty('--explanation-width');
      $('llm-explanation').style.removeProperty('--explanation-font');
      visible = entries.filter(entry => entry.offsetWidth > 0);
      const graphicHeight = Math.max(source.offsetHeight, target.offsetHeight);
      const titleHeight = $('corpus-title').offsetHeight, gap = innerWidth <= 700 ? 32 : 48;
      const top = Math.max(46, (stage.clientHeight - titleHeight - gap - graphicHeight) / 2);
      const center = top + titleHeight + gap + graphicHeight / 2;
      const shift = scene.clientWidth * .34;
      stage.style.setProperty('--corpus-title-top', `${top}px`);
      stage.style.setProperty('--corpus-center', `${center}px`);
      const linkStart = source.offsetWidth + 12;
      const boxLeft = scene.clientWidth / 2 + shift - target.offsetWidth / 2;
      $('corpus-link').style.left = `${linkStart}px`;
      $('corpus-link').style.width = `${Math.max(0, boxLeft - linkStart - 10)}px`;
      const narrow = innerWidth <= 700, compact = narrow && stage.clientHeight <= 730;
      const columns = narrow ? 1 : 2, rows = Math.ceil(visible.length / columns);
      const columnWidth = source.clientWidth / columns;
      const longest = Math.max(...visible.map(entry => entry.offsetWidth / parseFloat(getComputedStyle(entry).fontSize)));
      const fontSize = Math.min(narrow ? (compact ? 11 : 13) : (stage.clientHeight <= 800 ? 17 : 19), (columnWidth - 34) / longest);
      const rowHeight = Math.max(compact ? 14 : narrow ? 17 : 21, fontSize * 1.35);
      const rankTitleHeight = $('ranking-title').offsetHeight, rankGap = compact ? 24 : gap;
      const fullHeight = rows * rowHeight;
      const rankHeight = Math.min(fullHeight, Math.max(rowHeight * 3, stage.clientHeight - 70 - rankTitleHeight - rankGap));
      const rankTop = Math.max(46, (stage.clientHeight - rankTitleHeight - rankGap - rankHeight) / 2);
      const rankCenter = rankTop + rankTitleHeight + rankGap + rankHeight / 2;
      stage.style.setProperty('--ranking-title-top', `${rankTop}px`);
      const llmFontSize = Math.min(narrow ? (compact ? 16 : 18) : 25, (source.clientWidth * (narrow ? 1 : .62) - 40) / longest);
      const llmRowHeight = compact ? 22 : narrow ? 28 : llmFontSize * 1.55;
      const llmInputHeight = llmRowHeight * 10;
      const outputHeight = $('llm-explanation').offsetHeight, outputGap = compact ? 24 : 36;
      const promptGap = compact ? 24 : narrow ? 28 : 38;
      const promptAbove = $('llm-node').offsetHeight / 2 + promptGap;
      const promptTopPad = Math.max(0, promptAbove + $('llm-prompt').offsetHeight - llmInputHeight / 2);
      const llmGraphicHeight = (narrow ? llmInputHeight + outputGap + outputHeight : Math.max(llmInputHeight, $('llm-node').offsetHeight)) + promptTopPad;
      const llmTitleHeight = $('llm-title').offsetHeight, llmGap = compact ? 24 : narrow ? 32 : 56;
      const llmTop = Math.max(46, (stage.clientHeight - llmTitleHeight - llmGap - llmGraphicHeight) / 2);
      const llmCenter = llmTop + llmTitleHeight + llmGap + promptTopPad + llmInputHeight / 2;
      stage.style.setProperty('--llm-title-top', `${llmTop}px`);
      stage.style.setProperty('--llm-center', `${llmCenter}px`);
      stage.style.setProperty('--llm-prompt-y', `${-promptAbove}px`);
      const networkHeight = $('llm-network').getBoundingClientRect().height;
      const llmOutputY = narrow ? llmInputHeight / 2 + outputGap + outputHeight / 2 : -($('llm-node').offsetHeight - networkHeight) / 2;
      stage.style.setProperty('--llm-output-y', `${llmOutputY}px`);
      stage.style.setProperty('--llm-links-top', `${-llmInputHeight / 2}px`);
      stage.style.setProperty('--llm-links-height', `${llmGraphicHeight}px`);
      $('llm-links').setAttribute('viewBox', `0 0 ${scene.clientWidth} ${llmGraphicHeight}`);
      const candidateHeight = $('candidate-title').offsetHeight, candidateGap = narrow ? 36 : 56;
      const candidateTop = Math.max(46, (stage.clientHeight - candidateHeight - candidateGap - outputHeight) / 2);
      const candidateCenter = candidateTop + candidateHeight + candidateGap + outputHeight / 2;
      stage.style.setProperty('--candidate-title-top', `${candidateTop}px`);
      const explanationShiftX = (scene.clientWidth - $('llm-explanation').offsetWidth) / 2 - parseFloat(getComputedStyle($('llm-explanation')).left);
      const explanationShiftY = candidateCenter - llmCenter - llmOutputY;
      const explanationWidth = $('llm-explanation').offsetWidth;
      const explanationFont = parseFloat(getComputedStyle($('llm-explanation')).fontSize);
      const inputWidth = narrow ? scene.clientWidth * .58 : explanationWidth;
      const inputFont = narrow ? (compact ? 16 : 18) : explanationFont;
      const inputHeight = outputHeight * inputFont / explanationFont;
      const generationNodeHeight = $('generation-node').offsetHeight;
      const generationNetworkHeight = $('generation-network').getBoundingClientRect().height;
      const generationPortY = -(generationNodeHeight - generationNetworkHeight) / 2;
      const generationPromptY = -generationNodeHeight / 2 - promptGap;
      const stimulusHeight = $('generation-output').offsetHeight;
      const stimulusY = narrow ? generationNodeHeight / 2 + (compact ? 32 : 44) + stimulusHeight / 2 : generationPortY;
      const generationAbove = Math.max(-generationPromptY + $('generation-prompt').offsetHeight, stimulusHeight / 2 - stimulusY, inputHeight / 2 - generationPortY);
      const generationBelow = Math.max(generationNodeHeight / 2, stimulusY + stimulusHeight / 2, generationPortY + inputHeight / 2);
      const generationHeight = generationAbove + generationBelow;
      const generationTitleHeight = $('generation-title').offsetHeight;
      const generationTop = Math.max(46, (stage.clientHeight - generationTitleHeight - llmGap - generationHeight) / 2);
      const generationCenter = generationTop + generationTitleHeight + llmGap + generationAbove;
      stage.style.setProperty('--generation-title-top', `${generationTop}px`);
      stage.style.setProperty('--generation-center', `${generationCenter}px`);
      stage.style.setProperty('--generation-prompt-y', `${generationPromptY}px`);
      stage.style.setProperty('--stimulus-y', `${stimulusY}px`);
      stage.style.setProperty('--generation-links-top', `${-generationAbove}px`);
      stage.style.setProperty('--generation-links-height', `${generationHeight}px`);
      $('generation-links').setAttribute('viewBox', `0 0 ${scene.clientWidth} ${generationHeight}`);
      const inputShiftX = -parseFloat(getComputedStyle($('llm-explanation')).left);
      const inputShiftY = generationCenter + generationPortY - llmCenter - llmOutputY;
      const feedbackBrainHeight = $('feedback-brain-wrap').offsetHeight;
      const feedbackInputWidth = narrow ? scene.clientWidth * .52 : inputWidth;
      const feedbackRowHeight = Math.max(feedbackBrainHeight, inputHeight, narrow ? 0 : stimulusHeight);
      const feedbackLoopSpace = compact ? 36 : 44, feedbackRowGap = compact ? 28 : 36;
      const feedbackHeight = narrow ? feedbackLoopSpace + feedbackRowHeight + feedbackRowGap + stimulusHeight : feedbackRowHeight + 88;
      const feedbackTitleHeight = $('feedback-title').offsetHeight;
      const feedbackTop = Math.max(46, (stage.clientHeight - feedbackTitleHeight - llmGap - feedbackHeight) / 2);
      const feedbackCenter = feedbackTop + feedbackTitleHeight + llmGap + (narrow ? feedbackLoopSpace : 0) + feedbackRowHeight / 2;
      const feedbackStimulusY = narrow ? feedbackCenter + feedbackRowHeight / 2 + feedbackRowGap + stimulusHeight / 2 : feedbackCenter;
      const feedbackInputShiftY = feedbackCenter - llmCenter - llmOutputY;
      const stimulusShiftX = narrow ? 0 : -scene.clientWidth * .35;
      const stimulusShiftY = feedbackStimulusY - generationCenter - stimulusY;
      stage.style.setProperty('--feedback-title-top', `${feedbackTop}px`);
      stage.style.setProperty('--feedback-brain-top', `${feedbackCenter - feedbackBrainHeight / 2}px`);
      $('feedback-links').setAttribute('viewBox', `0 0 ${scene.clientWidth} ${stage.clientHeight}`);
      geometry = { center, rankCenter, cloudHeight: source.offsetHeight, rankHeight, fullHeight, columns, rows, columnWidth, fontSize, rowHeight, llmCenter, llmInputHeight, llmFontSize, llmRowHeight, explanationShiftX, explanationShiftY, explanationWidth, explanationFont, inputWidth, inputFont, inputShiftX, inputShiftY, feedbackInputWidth, feedbackInputShiftY, stimulusShiftX, stimulusShiftY, narrow, compact };
      rank(requestedRank);
      return { x: shift, y: center - baseCenter, rankY: rankCenter - baseCenter };
    }
    function rank(amount) {
      requestedRank = amount;
      if (!geometry || !sorted) return;
      const centering = reduced.matches ? Number(candidateBlend >= .5) : candidateBlend * candidateBlend * (3 - 2 * candidateBlend);
      const generating = reduced.matches ? Number(generationBlend >= .5) : generationBlend * generationBlend * (3 - 2 * generationBlend);
      const feedback = reduced.matches ? Number(feedbackBlend >= .5) : feedbackBlend * feedbackBlend * (3 - 2 * feedbackBlend);
      outputShift = {
        x: mix(geometry.explanationShiftX * centering, geometry.inputShiftX, generating),
        y: mix(mix(geometry.explanationShiftY * centering, geometry.inputShiftY, generating), geometry.feedbackInputShiftY, feedback)
      };
      $('llm-explanation').style.setProperty('--explanation-width', `${mix(mix(geometry.explanationWidth, geometry.inputWidth, generating), geometry.feedbackInputWidth, feedback)}px`);
      $('llm-explanation').style.setProperty('--explanation-font', `${mix(geometry.explanationFont, geometry.inputFont, generating)}px`);
      $('llm-explanation').style.setProperty('--explanation-shift-x', `${outputShift.x}px`);
      $('llm-explanation').style.setProperty('--explanation-shift-y', `${outputShift.y}px`);
      $('llm-explanation').style.setProperty('--explanation-line-align', geometry.narrow ? 1 : centering);
      const t = reduced.matches ? Number(amount >= .5) : amount * amount * (3 - 2 * amount);
      const focusing = clamp((llmBlend - .1) / .75);
      const focus = reduced.matches ? Number(llmBlend >= .5) : focusing * focusing * (3 - 2 * focusing);
      stage.style.setProperty('--corpus-center', `${mix(mix(geometry.center, geometry.rankCenter, t), geometry.llmCenter, focus)}px`);
      const reading = llmBlend >= .55 && candidateBlend < 1 && !reduced.matches;
      source.classList.toggle('is-reading', reading); $('llm-scene').classList.toggle('is-reading', reading);
      $('generation-scene').classList.toggle('is-reading', generationBlend >= .6 && feedbackBlend < .35 && !reduced.matches);
      $('generation-output').style.setProperty('--stimulus-shift-x', `${geometry.stimulusShiftX * feedback}px`);
      $('generation-output').style.setProperty('--stimulus-shift-y', `${geometry.stimulusShiftY * feedback}px`);
      $('feedback-scene').classList.toggle('is-active', feedbackBlend >= .85 && closingBlend < .45 && !reduced.matches);
      if (generationBlend > 0) connectGeneration();
      if (feedbackBlend > 0) connectFeedback();
      if (t === 0) { restoreCloud(); return; }
      if (!startPositions) {
        reset();
        startPositions = new Map(visible.map(entry => {
          const style = getComputedStyle(entry);
          const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
          return [entry, {
            x: entry.offsetLeft + matrix.m41, y: entry.offsetTop + matrix.m42,
            fontSize: parseFloat(style.fontSize), color: style.color.match(/[\d.]+/g).slice(0, 3).map(Number)
          }];
        }));
        source.classList.add('is-ranking'); source.append(...sorted);
        source.setAttribute('role', 'list');
        source.setAttribute('aria-label', 'Snippets ranked from higher predicted RSC activation in red to lower predicted activation in blue.');
        entries.forEach(entry => {
          const score = scoreById.get(entry.dataset.corpusId), position = rankById.get(entry.dataset.corpusId);
          entry.removeAttribute('aria-hidden'); entry.setAttribute('role', 'listitem');
          entry.setAttribute('aria-posinset', position); entry.setAttribute('aria-setsize', entries.length);
          entry.setAttribute('aria-label', `${position}. ${entry.textContent}. Predicted RSC response: ${score.toFixed(2)}.`);
          entry.title = `Predicted RSC response: ${score.toFixed(2)}`;
        });
      }
      source.style.height = `${mix(mix(geometry.cloudHeight, geometry.rankHeight, t), geometry.llmInputHeight, focus)}px`;
      const scrolling = t === 1 && llmBlend === 0 && geometry.fullHeight > geometry.rankHeight;
      source.style.overflow = scrolling ? 'hidden auto' : 'visible';
      if (scrolling) source.tabIndex = 0; else { source.removeAttribute('tabindex'); source.scrollTop = 0; }
      source.setAttribute('aria-label', llmBlend >= .5 ? 'The ten snippets with the highest predicted RSC responses, used as input to the LLM.' : 'Snippets ranked from higher predicted RSC activation in red to lower predicted activation in blue.');
      sorted.filter(entry => startPositions.has(entry)).forEach((entry, i) => {
        const start = startPositions.get(entry), column = Math.floor(i / geometry.rows), row = i % geometry.rows;
        const endX = column * geometry.columnWidth + 26, endY = row * geometry.rowHeight;
        const color = responseColor(scoreById.get(entry.dataset.corpusId)).map((value, j) => Math.round(mix(start.color[j], value, t)));
        const position = rankById.get(entry.dataset.corpusId), isInput = position <= 10;
        const inputY = (position - 1) * geometry.llmRowHeight + (geometry.llmRowHeight - geometry.llmFontSize * 1.2) / 2;
        const x = mix(mix(start.x, endX, t), 26, isInput ? focus : 0);
        const y = mix(mix(start.y, endY, t), inputY, isInput ? focus : 0);
        entry.style.transform = `translate3d(${x}px,${y}px,0)`;
        entry.style.fontSize = `${mix(mix(start.fontSize, geometry.fontSize, t), geometry.llmFontSize, isInput ? focus : 0)}px`;
        entry.style.color = `rgb(${color.join(',')})`;
        entry.style.opacity = isInput || llmBlend === 0 ? '' : 1 - clamp(llmBlend / .35);
        entry.style.visibility = !isInput && llmBlend >= .35 ? 'hidden' : '';
        entry.setAttribute('aria-hidden', String(!isInput && llmBlend >= .35));
        entry.setAttribute('aria-setsize', llmBlend >= .5 ? 10 : entries.length);
      });
      if (llmBlend > 0) connectLLM();
    }
    function connectLLM() {
      const svg = $('llm-links').getBoundingClientRect();
      const node = $('llm-network').getBoundingClientRect();
      const endX = node.left + node.width * 8 / 220 - svg.left, endY = node.top + node.height / 2 - svg.top;
      const prompt = $('llm-prompt').getBoundingClientRect(), promptX = node.left + node.width / 2 - svg.left;
      const promptPath = `M${promptX},${prompt.bottom + 10 - svg.top} L${promptX},${node.top + node.height * .16 - svg.top}`;
      $('llm-prompt-link').setAttribute('d', promptPath);
      $('llm-prompt-trace').setAttribute('d', promptPath);
      llmConnections.forEach(({ entry, wire, trace }) => {
        const rect = entry.getBoundingClientRect(), x = rect.right + 10 - svg.left, y = rect.top + rect.height / 2 - svg.top;
        const bend = Math.max(12, (endX - x) * .52);
        const path = `M${x},${y} C${x + bend},${y} ${endX - bend * .55},${endY} ${endX},${endY}`;
        wire.setAttribute('d', path); trace.setAttribute('d', path);
      });
      // The connectors fade in place while the same output moves away from them.
      const outputRect = $('llm-explanation').getBoundingClientRect();
      const output = { left: outputRect.left - outputShift.x, top: outputRect.top - outputShift.y, width: outputRect.width, height: outputRect.height };
      let path;
      if (innerWidth <= 700) {
        const x = node.left + node.width / 2 - svg.left, y = $('llm-node').getBoundingClientRect().bottom + 10 - svg.top;
        const toX = output.left + output.width / 2 - svg.left, toY = output.top - 12 - svg.top;
        path = `M${x},${y} L${toX},${toY}`;
      } else {
        const x = node.left + node.width * 212 / 220 - svg.left, toX = output.left - 18 - svg.left;
        const toY = output.top + output.height / 2 - svg.top;
        path = `M${x},${toY} L${toX},${toY}`;
      }
      $('llm-output-link').setAttribute('d', path);
      $('llm-output-traces').querySelectorAll('path').forEach(trace => trace.setAttribute('d', path));
    }
    function connectGeneration() {
      const svg = $('generation-links').getBoundingClientRect();
      const node = $('generation-network').getBoundingClientRect();
      const prompt = $('generation-prompt').getBoundingClientRect();
      const output = $('generation-output').getBoundingClientRect();
      const inputLines = [...$('llm-explanation').children].map(line => line.getBoundingClientRect());
      const portY = node.top + node.height / 2 - svg.top;
      const promptX = node.left + node.width / 2 - svg.left;
      const inputPath = `M${Math.max(...inputLines.map(line => line.right)) + 12 - svg.left},${portY} L${node.left + node.width * 8 / 220 - svg.left},${portY}`;
      const promptPath = `M${promptX},${prompt.bottom + 10 - svg.top} L${promptX},${node.top + node.height * .16 - svg.top}`;
      const outputPath = geometry.narrow
        ? `M${promptX},${$('generation-node').getBoundingClientRect().bottom + 10 - svg.top} L${output.left + output.width / 2 - svg.left},${output.top - 14 - svg.top}`
        : `M${node.left + node.width * 212 / 220 - svg.left},${portY} L${output.left - 18 - svg.left},${portY}`;
      for (const [name, path] of [['input', inputPath], ['prompt', promptPath]]) {
        $(`generation-${name}-link`).setAttribute('d', path);
        $(`generation-${name}-trace`).setAttribute('d', path);
      }
      $('generation-output-link').setAttribute('d', outputPath);
      $('generation-output-traces').querySelectorAll('path').forEach(trace => trace.setAttribute('d', outputPath));
    }
    function connectFeedback() {
      const svg = $('feedback-links').getBoundingClientRect();
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { left: r.left - svg.left, right: r.right - svg.left, top: r.top - svg.top, bottom: r.bottom - svg.top, x: r.left + r.width / 2 - svg.left, y: r.top + r.height / 2 - svg.top };
      };
      const input = rect($('llm-explanation')), output = rect($('generation-output')), brain = rect($('feedback-brain'));
      const lines = [...$('llm-explanation').children].map(rect);
      let stimulusPath, brainPath, returnPath, captionX, captionY;
      if (geometry.narrow) {
        stimulusPath = `M${input.x},${input.bottom + 10} L${input.x},${output.top - 14}`;
        brainPath = `M${brain.x},${output.top - 14} L${brain.x},${brain.bottom + 8}`;
        const loopY = Math.min(brain.top, input.top) - (geometry.compact ? 18 : 24);
        returnPath = `M${brain.x},${brain.top - 6} C${brain.x},${loopY} ${input.x},${loopY} ${input.x},${input.top - 10}`;
        captionX = (input.x + brain.x) / 2; captionY = loopY - 20;
      } else {
        stimulusPath = `M${Math.max(...lines.map(line => line.right)) + 12},${input.y} L${output.left - 18},${output.y}`;
        brainPath = `M${output.right + 12},${output.y} L${brain.left + 8},${brain.y}`;
        const loopY = Math.max(brain.bottom, output.bottom, input.bottom) + 56;
        returnPath = `M${brain.x},${brain.bottom + 8} C${brain.x},${loopY - 18} ${brain.x - 18},${loopY} ${brain.x - 40},${loopY} L${input.x + 40},${loopY} C${input.x + 18},${loopY} ${input.x},${loopY - 18} ${input.x},${loopY - 40} L${input.x},${input.bottom + 12}`;
        captionX = (input.x + brain.x) / 2; captionY = loopY + 12;
      }
      for (const [name, path] of [['stimulus', stimulusPath], ['brain', brainPath], ['return', returnPath]]) {
        $(`feedback-${name}-link`).setAttribute('d', path);
        $(`feedback-${name}-trace`).setAttribute('d', path);
      }
      $('feedback-caption').style.left = `${captionX}px`;
      $('feedback-caption').style.top = `${captionY}px`;
    }
    function advance(dt) {
      if (!isActive || !visible.length) return;
      const origin = scene.getBoundingClientRect(), box = target.getBoundingClientRect();
      untilNext -= dt;
      if (untilNext <= 0 && flights.length < (innerWidth <= 700 ? 3 : 6)) {
        const entry = visible[(cursor++ * 17) % visible.length];
        if (!entry.classList.contains('is-in-flight')) {
          const rect = entry.getBoundingClientRect(), style = getComputedStyle(entry);
          const node = document.createElement('span');
          node.className = 'corpus-flight'; node.dataset.corpusId = entry.dataset.corpusId;
          node.textContent = entry.textContent;
          node.style.fontSize = style.fontSize; node.style.fontStyle = style.fontStyle; node.style.color = style.color;
          stream.append(node); entry.classList.add('is-in-flight');
          flights.push({ entry, node, x: rect.x + rect.width / 2 - origin.x, y: rect.y + rect.height / 2 - origin.y, elapsed: 0, duration: 2.8 + cursor % 4 * .2 });
        }
        untilNext = innerWidth <= 700 ? .9 : .5;
      }
      const endX = box.x + box.width * .3 - origin.x, endY = box.y + box.height / 2 - origin.y;
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i]; f.elapsed += dt;
        const t = clamp(f.elapsed / f.duration), u = 1 - t;
        const distance = endX - f.x;
        const x = u * u * u * f.x + 3 * u * u * t * (f.x + distance * .42) + 3 * u * t * t * (endX - distance * .18) + t * t * t * endX;
        const y = f.y + (endY - f.y) * t * t * (3 - 2 * t);
        f.node.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) translate(-50%,-50%) scale(${1 - .45 * t * t})`;
        const clearingCloud = clamp((x - source.offsetWidth + 40) / 100);
        f.node.style.opacity = (.12 + .73 * clearingCloud) * (1 - clamp((t - .78) / .22));
        if (t === 1) { f.node.remove(); f.entry.classList.remove('is-in-flight'); flights.splice(i, 1); }
      }
    }
    return { setActive, layout, advance, reset, rank, setScores };
  }

  // Free, slow movement within the cloud. Neighbors gently separate so labels
  // stay readable; hovered/focused words hold still for selection.
  const floaters = [...cloud.querySelectorAll('.snippet')].map((button, i) => ({
    button, x: 0, y: 0, w: 0, h: 0,
    vx: Math.cos(i * 2.4) * 2.2, vy: Math.sin(i * 2.4) * 1.8
  }));
  let cloudWidth = 0, cloudHeight = 0, cloudFrame = 0, cloudTime = 0;
  function layoutScene() {
    // Wire and moving dash use the same path, just like the LLM connectors.
    // Clip the trace at that path's endpoints, including its rounded caps.
    document.querySelectorAll('.signal').forEach(signal => {
      const width = signal.getBoundingClientRect().width;
      const start = 1, end = Math.max(start, width - 4);
      signal.querySelector('svg').setAttribute('viewBox', `0 0 ${width} 12`);
      signal.querySelectorAll('.llm-wire,.llm-trace').forEach(path => path.setAttribute('d', `M${start},6 L${end},6`));
      signal.querySelector('.signal-limit').setAttribute('width', end - start);
    });
    const compact = innerWidth <= 700 && innerHeight <= 730;
    const headingHeight = Math.max($('opening-title').offsetHeight, $('playground-title').offsetHeight);
    const gap = compact ? 6 : 12;
    const copyHeight = Math.max($('model-description').offsetHeight, document.querySelector('.instruction').offsetHeight);
    const sceneHeight = headingHeight + cloudHeight + model.offsetHeight + copyHeight + gap * 3;
    // Center one shared envelope for both panels, independently of scroll position.
    // Leave room for the continuation arrow on shorter screens.
    const arrowSpace = $('next').offsetHeight + 16;
    const top = Math.max(46, Math.min((stage.clientHeight - sceneHeight) / 2, stage.clientHeight - sceneHeight - arrowSpace));
    const cloudTop = top + headingHeight + gap;
    const modelTop = cloudTop + cloudHeight + gap;
    const copyTop = modelTop + model.offsetHeight + gap;
    stage.style.setProperty('--scene-top', `${top}px`);
    stage.style.setProperty('--cloud-top', `${cloudTop}px`);
    stage.style.setProperty('--model-top', `${modelTop}px`);
    stage.style.setProperty('--copy-top', `${copyTop}px`);
    stage.style.setProperty('--next-top', `${copyTop + $('model-description').offsetHeight + 8}px`);
    const boxTop = modelTop + (model.offsetHeight - target.offsetHeight) / 2;
    const titleTop = boxTop - $('black-box-title').offsetHeight - (compact ? 28 : 48);
    stage.style.setProperty('--black-box-title-top', `${Math.max(46, titleTop)}px`);
    const narrow = innerWidth <= 700;
    const baseWidth = parseFloat(getComputedStyle(model).gridTemplateColumns.split(' ').at(-1));
    const width = narrow ? model.clientWidth - target.offsetWidth - 16 : Math.min(760, model.clientWidth * .67);
    const height = Math.min(340, Math.max(compact ? 132 : 180, width * .55));
    const rscTitleHeight = $('rsc-title').offsetHeight, rscGap = narrow ? 32 : 40;
    const rscTop = Math.max(46, (stage.clientHeight - rscTitleHeight - rscGap - Math.max(height, target.offsetHeight)) / 2);
    const center = rscTop + rscTitleHeight + rscGap + Math.max(height, target.offsetHeight) / 2;
    rscLayout = {
      baseWidth, baseHeight: model.offsetHeight, width, height,
      x: narrow ? -(model.clientWidth / 2 - target.offsetWidth / 2 - 4) : -model.clientWidth * .29,
      y: center - modelTop - model.offsetHeight / 2
    };
    stage.style.setProperty('--rsc-title-top', `${rscTop}px`);
    corpusOffset = corpus.layout(modelTop + model.offsetHeight / 2);
    positionDiagram();
  }
  function measureCloud() {
    cloudWidth = cloud.clientWidth; cloudHeight = cloud.clientHeight;
    const columns = Math.max(2, Math.min(5, Math.floor(cloudWidth / 200))), rows = Math.ceil(floaters.length / columns);
    const compact = innerWidth <= 700 && innerHeight <= 730;
    const rowHeight = Math.max(...floaters.map(f => f.button.offsetHeight)) + (compact ? 4 : 10);
    cloudHeight = Math.ceil(rows * rowHeight); cloud.style.height = `${cloudHeight}px`;
    floaters.forEach((f, i) => {
      f.w = f.button.offsetWidth; f.h = f.button.offsetHeight;
      const col = i % columns, row = Math.floor(i / columns);
      f.x = (col + .5) * cloudWidth / columns - f.w / 2 + Math.sin(i * 3) * (compact ? 2 : 6);
      f.y = (row + .5) * cloudHeight / rows - f.h / 2 + Math.cos(i * 2) * (compact ? .5 : 2);
      f.x = Math.max(2, Math.min(cloudWidth - f.w - 2, f.x));
      f.y = Math.max(2, Math.min(cloudHeight - f.h - 2, f.y));
      f.button.style.transform = `translate3d(${f.x}px,${f.y}px,0)`;
    });
    layoutScene();
  }
  function floatCloud(now) {
    cloudFrame = 0;
    const dt = Math.min((now - cloudTime) / 1000, .05); cloudTime = now;
    if (selectedPanel === 4 && !reduced.matches) corpus.advance(dt);
    if (selectedPanel === 1 && !drag && !reduced.matches) {
      for (const f of floaters) {
        f.held = f.button.matches(':hover,:focus-visible');
        if (f.held) continue;
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.x < 2 || f.x + f.w > cloudWidth - 2) f.vx *= -1;
        if (f.y < 2 || f.y + f.h > cloudHeight - 2) f.vy *= -1;
        f.x = Math.max(2, Math.min(cloudWidth - f.w - 2, f.x));
        f.y = Math.max(2, Math.min(cloudHeight - f.h - 2, f.y));
      }
      for (let i = 0; i < floaters.length; i++) for (let j = i + 1; j < floaters.length; j++) {
        const a = floaters[i], b = floaters[j];
        const dx = b.x + b.w / 2 - a.x - a.w / 2;
        const dy = b.y + b.h / 2 - a.y - a.h / 2;
        const overlapX = (a.w + b.w) / 2 + 10 - Math.abs(dx);
        const overlapY = (a.h + b.h) / 2 + (cloudWidth < 400 ? 3 : 6) - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          const vertical = overlapY < overlapX;
          const delta = Math.min(vertical ? overlapY : overlapX, 8) * dt * 2;
          const sign = (vertical ? dy : dx) >= 0 ? 1 : -1;
          const axis = vertical ? 'y' : 'x', velocity = vertical ? 'vy' : 'vx';
          if (!a.held) { a[axis] -= sign * delta; a[velocity] = -sign * Math.abs(a[velocity]); }
          if (!b.held) { b[axis] += sign * delta; b[velocity] = sign * Math.abs(b[velocity]); }
        }
      }
      floaters.forEach(f => {
        f.x = Math.max(2, Math.min(cloudWidth - f.w - 2, f.x));
        f.y = Math.max(2, Math.min(cloudHeight - f.h - 2, f.y));
        f.button.style.transform = `translate3d(${f.x.toFixed(2)}px,${f.y.toFixed(2)}px,0)`;
      });
    }
    if (!document.hidden && !reduced.matches) cloudFrame = requestAnimationFrame(floatCloud);
  }
  function startCloud() { if (!cloudFrame && !document.hidden && !reduced.matches) { cloudTime = performance.now(); cloudFrame = requestAnimationFrame(floatCloud); } }
  new ResizeObserver(measureCloud).observe(cloud);
  document.fonts.ready.then(measureCloud);
  addEventListener('resize', measureCloud);
  document.addEventListener('visibilitychange', startCloud);
  reduced.addEventListener('change', startCloud);
  const corpus = createCorpus();
  reduced.addEventListener('change', () => { corpus.reset(); renderScroll(); });
  renderScroll(); measureCloud(); startCloud(); initialize();
})();
