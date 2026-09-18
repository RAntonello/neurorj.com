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
    if (active && !wasVisible) load();
    if (!active) pause();
    wasVisible = active;
  }
  // The paragraph persists through generation and feedback. Pause only when
  // leaving those two panels, and never resume automatically on returning.
  new MutationObserver(updateVisibility).observe(scene, { attributes: true, attributeFilter: ['aria-hidden'] });
  document.addEventListener('visibilitychange', updateVisibility);
  sync(); updateVisibility();
})();
