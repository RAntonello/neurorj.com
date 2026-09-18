(() => {
  'use strict';
  const audio = document.getElementById('paragraph-audio');
  const snippetAudio = document.getElementById('snippet-audio');
  const scene = document.getElementById('generation-scene');
  const controls = document.getElementById('paragraph-controls');
  const play = document.getElementById('paragraph-play');
  const mute = document.getElementById('paragraph-mute');
  const position = document.getElementById('paragraph-position');
  const error = document.getElementById('paragraph-audio-error');
  if (!audio || !scene || !controls || !play || !mute || !position || !error) return;
  let sourcePromise, sourceURL, request = 0, wasVisible = false;
  const visible = () => scene.getAttribute('aria-hidden') === 'false' && !document.hidden;
  const reading = createReadingGuide();

  function createReadingGuide() {
    const paragraph = document.getElementById('generation-text');
    // Natural phrase boundaries within this fixed, 39-word narration.
    const ends = [4, 8, 14, 19, 22, 27, 31, 35, 39];
    let phrases = [], current = -1, frame = 0, timingPromise;
    function paint() {
      const time = audio.currentTime;
      const next = visible() && !audio.ended
        ? phrases.findIndex(phrase => time >= phrase.start && time < phrase.end) : -1;
      if (next === current) return;
      phrases[current]?.element.classList.remove('is-spoken');
      phrases[next]?.element.classList.add('is-spoken');
      current = next;
    }
    function tick() {
      frame = 0; paint();
      if (visible() && !audio.paused && !audio.ended && phrases.length) frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame); frame = 0;
      tick();
    }
    function load() {
      if (!timingPromise) timingPromise = (async () => {
        const response = await fetch('audio/travel-paragraph.json');
        if (!response.ok) throw Error('Paragraph timings unavailable.');
        const timing = await response.json(), words = timing.words;
        const text = paragraph.textContent;
        if (timing.text !== text || timing.src !== audio.dataset.src
          || !Array.isArray(words) || words.length !== ends.at(-1)
          || words.map(word => word.word).join(' ') !== text
          || !Number.isFinite(timing.duration)
          || words.some((word, i) => !Number.isFinite(word.start) || !Number.isFinite(word.end)
            || word.start < 0 || word.end <= word.start || word.end > timing.duration
            || (i > 0 && word.start < words[i - 1].end))) throw Error('Paragraph timings do not match.');
        const content = document.createDocumentFragment();
        let start = 0;
        phrases = ends.map(end => {
          const element = document.createElement('span');
          element.className = 'spoken-phrase';
          element.textContent = words.slice(start, end).map(word => word.word).join(' ');
          if (start) content.append(' ');
          content.append(element);
          const phrase = { element, start: words[start].start, end: words[end - 1].end };
          start = end;
          return phrase;
        });
        paragraph.replaceChildren(content);
        sync();
      })().catch(() => {
        // The reading guide is optional; unavailable timings must not stop audio.
        timingPromise = null;
      });
      return timingPromise;
    }
    return { load, sync };
  }

  function sync() {
    const playing = !audio.paused && !audio.ended;
    controls.classList.toggle('is-playing', playing);
    play.querySelector('span').textContent = playing ? 'Pause' : audio.ended ? 'Replay' : error.hidden ? 'Listen' : 'Retry';
    play.setAttribute('aria-label', playing ? 'Pause the generated paragraph' : audio.ended ? 'Replay the generated paragraph' : error.hidden ? 'Listen to the generated paragraph' : 'Retry paragraph audio');
    const muteLabel = audio.muted ? 'Unmute audio' : 'Mute audio';
    mute.setAttribute('aria-pressed', String(audio.muted));
    mute.setAttribute('aria-label', muteLabel); mute.title = muteLabel;
    const duration = audio.duration;
    position.disabled = !Number.isFinite(duration) || duration <= 0;
    if (!position.disabled) {
      position.max = duration;
      position.value = audio.currentTime;
      position.setAttribute('aria-valuetext', `${Math.floor(audio.currentTime)} of ${Math.ceil(duration)} seconds`);
    }
    reading.sync();
  }

  function load() {
    if (!sourcePromise) {
      play.disabled = true; controls.setAttribute('aria-busy', 'true');
      sourcePromise = (async () => {
        const response = await fetch(audio.dataset.src);
        if (!response.ok) throw Error('Could not load paragraph audio.');
        // A local blob also allows reliable seeking on static preview servers.
        const blob = new Blob([await response.arrayBuffer()], { type: 'audio/mpeg' });
        if (sourceURL) URL.revokeObjectURL(sourceURL);
        sourceURL = URL.createObjectURL(blob); audio.src = sourceURL;
        error.hidden = true;
        return true;
      })().catch(() => {
        sourcePromise = null; error.hidden = false;
        return false;
      }).finally(() => {
        play.disabled = false; controls.removeAttribute('aria-busy'); sync();
      });
    }
    return sourcePromise;
  }

  function pause() { ++request; audio.pause(); sync(); }
  play.addEventListener('click', async () => {
    if (!visible()) return;
    if (!audio.paused) { pause(); return; }
    const current = ++request;
    if (!await load() || current !== request || !visible()) return;
    error.hidden = true;
    if (audio.ended) audio.currentTime = 0;
    snippetAudio?.pause();
    try { await audio.play(); }
    catch (cause) {
      if (current !== request || cause.name === 'AbortError') return;
      error.textContent = cause.name === 'NotAllowedError' ? 'Press Listen to play the paragraph.' : 'Audio could not play. Try again.';
      error.hidden = false; sync();
    }
  });
  mute.addEventListener('click', () => { audio.muted = !audio.muted; });
  position.addEventListener('input', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(position.value);
    sync();
  });
  for (const event of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'seeked']) audio.addEventListener(event, sync);
  audio.addEventListener('error', () => {
    sourcePromise = null; error.textContent = 'Audio could not load. Try again.'; error.hidden = false; sync();
  });
  audio.addEventListener('volumechange', () => {
    if (snippetAudio && snippetAudio.muted !== audio.muted) snippetAudio.muted = audio.muted;
    sync();
  });
  if (snippetAudio) {
    audio.muted = snippetAudio.muted;
    snippetAudio.addEventListener('volumechange', () => {
      if (audio.muted !== snippetAudio.muted) audio.muted = snippetAudio.muted;
    });
    snippetAudio.addEventListener('play', pause);
  }
  function updateVisibility() {
    const active = visible();
    if (active && !wasVisible) { load(); reading.load(); }
    if (!active) pause();
    wasVisible = active;
  }
  // The paragraph persists through generation and feedback. Pause only when
  // leaving those two panels, and never resume automatically on returning.
  new MutationObserver(updateVisibility).observe(scene, { attributes: true, attributeFilter: ['aria-hidden'] });
  document.addEventListener('visibilitychange', updateVisibility);
  sync(); updateVisibility();
})();
