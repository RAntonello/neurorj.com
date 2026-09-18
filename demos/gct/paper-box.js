(() => {
  'use strict';
  const link = document.getElementById('paper-box');
  const panel = document.getElementById('paper-panel');
  const image = link?.querySelector('img');
  if (!link || !panel || !image) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fineHover = matchMedia('(hover: hover) and (pointer: fine)');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 640 640');
  svg.setAttribute('class', 'paper-box-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // The original photograph stays intact. A copy of its front face swings
  // around the left edge, revealing light underneath. The top, right side,
  // and ground shadow never move, and the closed state is the original image.
  const frontOutline = 'M79.5 145 Q79 139 85 140 L478 151 Q485 151 486 158 L486 546 Q485 557 475 558 L89 542 Q79 541 79 532 Z';
  svg.innerHTML = `
    <defs>
      <clipPath id="paper-front-clip" clipPathUnits="userSpaceOnUse">
        <path d="${frontOutline}"/>
      </clipPath>
      <clipPath id="paper-side-clip" clipPathUnits="userSpaceOnUse">
        <path d="M484 155 561 101 562.5 461 Q562 472 555 482 L489 551 481 557 Z"/>
      </clipPath>
      <linearGradient id="paper-interior" x1="0" y1="0" x2="1" y2="0">
        <stop stop-color="#dadade"/><stop offset=".6" stop-color="#fff"/><stop offset=".98" stop-color="#fff"/><stop offset="1" stop-color="#d8d8dd"/>
      </linearGradient>
      <filter id="paper-light-wide" filterUnits="userSpaceOnUse" x="430" y="100" width="150" height="510" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="14"/>
      </filter>
      <filter id="paper-light-near" filterUnits="userSpaceOnUse" x="450" y="120" width="90" height="465" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="3.8"/>
      </filter>
      <filter id="paper-light-bloom" filterUnits="userSpaceOnUse" x="430" y="120" width="90" height="470" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="2.5"/>
      </filter>
    </defs>
    <image href="${image.getAttribute('src')}" width="640" height="640"/>
    <g data-part="reveal" visibility="hidden">
      <g clip-path="url(#paper-side-clip)">
        <path data-part="wide-spill" d="M484 155 L486 546" fill="none" stroke="white" stroke-width="40" filter="url(#paper-light-wide)"/>
        <path data-part="near-spill" d="M484 155 L486 546" fill="none" stroke="white" stroke-width="12" filter="url(#paper-light-near)"/>
      </g>
      <path data-part="interior" d="${frontOutline}" fill="url(#paper-interior)"/>
      <g data-part="door">
        <g clip-path="url(#paper-front-clip)">
          <image href="${image.getAttribute('src')}" width="640" height="640"/>
        </g>
      </g>
      <path data-part="bloom" fill="none" stroke="white" stroke-width="3.5" filter="url(#paper-light-bloom)"/>
    </g>`;

  const parts = Object.fromEntries([...svg.querySelectorAll('[data-part]')].map(node => [node.dataset.part, node]));
  // Orthographic rotation of the front face about its left vertical edge.
  // Its free edge moves left and slightly down toward the viewer, exposing
  // a narrow vertical crack. The photographed cube supplies both basis vectors.
  const hingeX = 79.5;
  const front = { x: 405, y: 12 }, depth = { x: 78, y: -55 };
  const maxAngle = 8.5 * Math.PI / 180;
  let position = 0, velocity = 0, target = 0, frame = 0, lastTime = 0;
  let hovered = false, focused = false, enhanced = false;

  function paint() {
    const open = Math.max(0, Math.min(1, position));
    parts.reveal.setAttribute('visibility', open > .00001 ? 'visible' : 'hidden');
    if (!open) return;
    const angle = maxAngle * open;
    const dx = front.x * (Math.cos(angle) - 1) - depth.x * Math.sin(angle);
    const dy = front.y * (Math.cos(angle) - 1) - depth.y * Math.sin(angle);
    const a = 1 + dx / front.x, b = dy / front.x;
    parts.door.setAttribute('transform', `matrix(${a} ${b} 0 1 ${hingeX * (1 - a)} ${-hingeX * b})`);
    const light = open * (2 - open);
    parts.interior.setAttribute('opacity', light);
    parts['wide-spill'].setAttribute('opacity', .3 * light);
    parts['near-spill'].setAttribute('opacity', .5 * light);
    const edgeX = 486 + dx;
    parts.bloom.setAttribute('d', `M${edgeX} ${158 + dy} L${edgeX} ${546 + dy}`);
    parts.bloom.setAttribute('opacity', .36 * light);
  }

  function stop() { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
  function tick(now) {
    frame = 0;
    const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
    // Analytic critically damped motion preserves velocity on interruptions.
    // Enter slowly; settle shut slightly faster, with no bounce or snapping.
    const omega = target ? 5.8 : 8;
    const delta = position - target, rate = velocity + omega * delta;
    const decay = Math.exp(-omega * dt);
    position = target + (delta + rate * dt) * decay;
    velocity = (velocity - omega * rate * dt) * decay;
    if (Math.abs(position - target) < .0002 && Math.abs(velocity) < .002) {
      position = target; velocity = 0; paint(); lastTime = 0; return;
    }
    paint(); frame = requestAnimationFrame(tick);
  }
  function update() {
    const visible = !document.hidden && Number(panel.style.opacity) > 0;
    const interactive = panel.getAttribute('aria-hidden') === 'false';
    target = visible && interactive && (hovered || focused) ? 1 : 0;
    if (!enhanced || !visible) { stop(); position = 0; velocity = 0; paint(); return; }
    if (reduced.matches) { stop(); position = target; velocity = 0; paint(); return; }
    if (!frame && (position !== target || velocity)) {
      lastTime = performance.now(); frame = requestAnimationFrame(tick);
    }
  }
  link.addEventListener('pointerenter', event => {
    hovered = event.pointerType === 'mouse' || (fineHover.matches && event.pointerType !== 'touch');
    update();
  });
  link.addEventListener('pointerleave', () => { hovered = false; update(); });
  link.addEventListener('focus', () => { focused = link.matches(':focus-visible'); update(); });
  link.addEventListener('blur', () => { focused = false; update(); });
  reduced.addEventListener('change', update);
  fineHover.addEventListener('change', () => { if (!fineHover.matches) hovered = false; update(); });
  document.addEventListener('visibilitychange', update);
  new MutationObserver(update).observe(panel, { attributes: true, attributeFilter: ['aria-hidden', 'style'] });
  async function enhance() {
    try { await image.decode(); } catch { return; }
    link.append(svg); link.dataset.enhanced = 'true'; enhanced = true; update();
  }
  enhance();
})();
