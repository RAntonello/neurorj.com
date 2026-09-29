(() => {
  'use strict';
  const panel = document.getElementById('black-box-panel');
  const stage = document.querySelector('.stage');
  const box = document.querySelector('#shared-model .interactive-box');
  const photo = box?.querySelector('.box-photo');
  const lens = document.getElementById('weights-lens');
  const caption = document.getElementById('weights-caption');
  if (!panel || !stage || !box || !photo || !lens || !caption) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ns = 'http://www.w3.org/2000/svg';
  const clamp = v => Math.max(0, Math.min(1, v));
  // Photograph geometry in its 640-unit image space, shared with paper-box.js.
  // The contents fill the front opening just inside the walls.
  const frontOutline = 'M79.5 145 Q79 139 85 140 L478 151 Q485 151 486 158 L486 546 Q485 557 475 558 L89 542 Q79 541 79 532 Z';
  const quad = [[90, 151], [476, 161], [476, 548], [89, 532]];
  const hingeX = 79.5, front = { x: 405, y: 12 }, depth = { x: 78, y: -55 };
  const maxAngle = 104 * Math.PI / 180;
  const warm = [232, 102, 50], cool = [60, 131, 196], dark = [16, 16, 18];
  const colorLimit = .04, driftSpeed = { col: .9, row: .55 };

  const inside = document.createElement('div');
  inside.className = 'weights-inside';
  inside.setAttribute('aria-hidden', 'true');
  const cavity = document.createElement('canvas');
  const grid = document.createElement('canvas');
  grid.className = 'weights-grid';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 640 640');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = `
    <defs>
      <clipPath id="weights-front-clip" clipPathUnits="userSpaceOnUse"><path d="${frontOutline}"/></clipPath>
      <linearGradient id="weights-door-inside" x1="0" y1="0" x2="1" y2="0">
        <stop stop-color="#2b2b2e"/><stop offset="1" stop-color="#151517"/>
      </linearGradient>
    </defs>
    <g data-part="door">
      <g data-part="door-outside" clip-path="url(#weights-front-clip)"><image href="${photo.getAttribute('src')}" width="640" height="640"/></g>
      <path data-part="door-inside" d="${frontOutline}" fill="url(#weights-door-inside)"/>
    </g>
    <g data-part="pointer">
      <path data-part="leader-halo" class="weights-leader-halo"/>
      <path data-part="leader" class="weights-leader"/>
      <circle data-part="marker-halo" class="weights-leader-halo" r="10"/>
      <circle data-part="marker" class="weights-leader" r="10"/>
    </g>`;
  const parts = Object.fromEntries([...svg.querySelectorAll('[data-part]')].map(node => [node.dataset.part, node]));
  inside.append(cavity, grid, svg);

  let weights = null, scale = 0, rows = 0, columns = 0, loading = null, retryAt = 0;
  let open = 0, panelOpacity = 0, enhanced = false;
  let frame = 0, lastTime = 0, position = { col: 0, row: 0 }, lensSize = 0, lensCell = 42, lensCenter = { x: 0, y: 0 };
  let paintedSize = 0;

  function mix(from, to, t) { return from.map((value, i) => Math.round(value + (to[i] - value) * t)); }
  function colorFor(value) { return mix(dark, value > 0 ? warm : cool, Math.min(Math.abs(value) / colorLimit, 1)); }
  function valueAt(row, col) { return weights[row * columns + col] * scale; }
  function format(value) { return Math.abs(value) < .0005 ? '0.000' : `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(3)}`; }
  // Contents coordinates (u across features, v down patches) to image units.
  function toImage(u, v) {
    const [a, b, c, d] = quad;
    return [0, 1].map(i => (1 - u) * (1 - v) * a[i] + u * (1 - v) * b[i] + u * v * c[i] + (1 - u) * v * d[i]);
  }
  function fromImage(x, y) {
    const [a, b, c, d] = quad;
    const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
    const e = [b[0] - a[0], b[1] - a[1]], f = [d[0] - a[0], d[1] - a[1]];
    const g = [a[0] - b[0] + c[0] - d[0], a[1] - b[1] + c[1] - d[1]], h = [x - a[0], y - a[1]];
    const k2 = cross(g, f), k1 = cross(e, f) + cross(h, g), k0 = cross(h, e);
    const root = k1 * k1 - 4 * k0 * k2;
    if (root < 0) return null;
    // The stable form of the quadratic's roots; keep the one inside the face.
    const w = Math.sqrt(root);
    let v = 2 * k0 / (-k1 - w);
    if (!(v >= 0 && v <= 1)) v = 2 * k0 / (-k1 + w);
    const u = (h[0] - f[0] * v) / (e[0] + g[0] * v);
    return u >= 0 && u < 1 && v >= 0 && v < 1 ? [u, v] : null;
  }

  function paintCavity(size) {
    cavity.width = cavity.height = size;
    const context = cavity.getContext('2d'), k = size / 640;
    context.setTransform(k, 0, 0, k, 0, 0);
    context.fillStyle = '#0c0c0d';
    context.fill(new Path2D(frontOutline));
  }
  // Each device pixel shows the single weight at its center, so the texture
  // keeps the matrix's own mix of structure and noise.
  function paintGrid(size) {
    grid.width = grid.height = size;
    if (!weights) return;
    const context = grid.getContext('2d'), k = size / 640;
    const xs = quad.map(p => p[0] * k), ys = quad.map(p => p[1] * k);
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
    const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    const image = context.createImageData(x1 - x0, y1 - y0);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const uv = fromImage((px + .5) / k, (py + .5) / k);
      if (!uv) continue;
      const color = colorFor(valueAt(Math.floor(uv[1] * rows), Math.floor(uv[0] * columns)));
      const i = ((py - y0) * (x1 - x0) + px - x0) * 4;
      image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = 255;
    }
    context.putImageData(image, x0, y0);
    // The walls above and beside the opening shade the contents slightly.
    context.setTransform(k, 0, 0, k, 0, 0);
    const top = context.createLinearGradient(0, quad[0][1], 0, quad[0][1] + 60);
    top.addColorStop(0, 'rgba(0,0,0,.6)'); top.addColorStop(1, 'rgba(0,0,0,0)');
    const left = context.createLinearGradient(quad[0][0], 0, quad[0][0] + 34, 0);
    left.addColorStop(0, 'rgba(0,0,0,.45)'); left.addColorStop(1, 'rgba(0,0,0,0)');
    const region = new Path2D(`M${quad.map(p => p.join(' ')).join(' L')} Z`);
    context.save(); context.clip(region);
    context.fillStyle = top; context.fillRect(0, 0, 640, 640);
    context.fillStyle = left; context.fillRect(0, 0, 640, 640);
    context.restore();
  }
  function paintInside() {
    const size = Math.min(1280, Math.round(inside.clientWidth * (devicePixelRatio || 1)));
    if (!size || size === paintedSize) return;
    paintedSize = size;
    paintCavity(size); paintGrid(size);
  }

  function paintDoor() {
    inside.classList.toggle('is-open', open > .0001);
    const angle = maxAngle * open;
    const dx = front.x * (Math.cos(angle) - 1) - depth.x * Math.sin(angle);
    const dy = front.y * (Math.cos(angle) - 1) - depth.y * Math.sin(angle);
    const a = 1 + dx / front.x, b = dy / front.x;
    parts.door.setAttribute('transform', `matrix(${a} ${b} 0 1 ${hingeX * (1 - a)} ${-hingeX * b})`);
    // Past edge-on, the viewer sees the plain inside of the door.
    parts['door-outside'].setAttribute('visibility', a >= 0 ? 'visible' : 'hidden');
    parts['door-inside'].setAttribute('visibility', a < 0 ? 'visible' : 'hidden');
  }

  function layout() {
    const stageRect = stage.getBoundingClientRect(), rect = inside.getBoundingClientRect();
    if (!rect.width) return;
    const unit = rect.width / 640, narrow = innerWidth <= 700;
    const faceY = rect.top - stageRect.top + toImage(.5, .5)[1] * unit;
    const diagram = document.getElementById('shared-model').getBoundingClientRect();
    // The lens sits in the input's empty column, clear of the fully open door,
    // which swings out left of the hinge.
    const doorLeft = rect.left - stageRect.left + (hingeX - 190) * unit;
    const gap = narrow ? 14 : 64, margin = narrow ? 16 : 40;
    lensSize = Math.max(84, Math.min(narrow ? 124 : innerHeight <= 800 ? 150 : 172, doorLeft - gap - margin));
    lensCell = narrow ? 34 : 42;
    lensCenter = { x: doorLeft - gap - lensSize / 2, y: faceY };
    lens.style.width = lens.style.height = `${lensSize}px`;
    lens.style.transform = `translate(${lensCenter.x - lensSize / 2}px, ${lensCenter.y - lensSize / 2}px)`;
    const captionTop = Math.max(diagram.bottom, lensCenter.y + lensSize / 2) - stageRect.top + (narrow ? 22 : 34);
    caption.style.top = `${captionTop}px`;
    const size = Math.round(lensSize * (devicePixelRatio || 1));
    const canvas = lens.querySelector('canvas');
    if (canvas.width !== size) { canvas.width = canvas.height = size; }
    paintPointer();
  }

  function paintPointer() {
    const rect = inside.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
    if (!rect.width || !weights) return;
    const unit = rect.width / 640;
    const [mx, my] = toImage((position.col + .5) / columns, (position.row + .5) / rows);
    const marker = 6.5 / unit;
    parts.marker.setAttribute('cx', mx); parts.marker.setAttribute('cy', my); parts.marker.setAttribute('r', marker);
    parts['marker-halo'].setAttribute('cx', mx); parts['marker-halo'].setAttribute('cy', my); parts['marker-halo'].setAttribute('r', marker);
    // Lens center in image units; the leader runs between the two circles.
    const lx = (lensCenter.x + stageRect.left - rect.left) / unit, ly = (lensCenter.y + stageRect.top - rect.top) / unit;
    const length = Math.hypot(lx - mx, ly - my), radius = lensSize / 2 / unit;
    if (length <= radius + marker) { parts.leader.removeAttribute('d'); parts['leader-halo'].removeAttribute('d'); return; }
    const ux = (lx - mx) / length, uy = (ly - my) / length;
    const d = `M${mx + ux * marker} ${my + uy * marker} L${lx - ux * radius} ${ly - uy * radius}`;
    parts.leader.setAttribute('d', d); parts['leader-halo'].setAttribute('d', d);
  }

  function paintLens() {
    if (!lensSize) return;
    const canvas = lens.querySelector('canvas'), context = canvas.getContext('2d');
    const size = canvas.width, dpr = size / lensSize;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = `rgb(${dark})`; context.fillRect(0, 0, size, size);
    if (!weights) return;
    const cell = lensCell * dpr, half = size / 2;
    const span = Math.ceil(size / cell / 2) + 1;
    const baseCol = Math.floor(position.col), baseRow = Math.floor(position.row);
    const offsetX = (position.col - baseCol + .5) * cell, offsetY = (position.row - baseRow + .5) * cell;
    context.font = `${lensCell / 4 * dpr}px 'IBM Plex Mono', ui-monospace, monospace`;
    context.textAlign = 'center'; context.textBaseline = 'middle';
    for (let dr = -span; dr <= span; dr++) for (let dc = -span; dc <= span; dc++) {
      const row = ((baseRow + dr) % rows + rows) % rows, col = ((baseCol + dc) % columns + columns) % columns;
      const value = valueAt(row, col);
      const x = half - offsetX + dc * cell, y = half - offsetY + dr * cell;
      context.fillStyle = `rgb(${colorFor(value)})`;
      context.fillRect(x, y, cell, cell);
      context.fillStyle = 'rgba(255,255,255,.92)';
      context.fillText(format(value), x + cell / 2, y + cell / 2 + .5 * dpr);
    }
    // Hairline cell borders keep individual weights distinct.
    context.strokeStyle = 'rgba(0,0,0,.45)'; context.lineWidth = Math.max(1, dpr);
    context.beginPath();
    for (let i = -span; i <= span + 1; i++) {
      const x = half - offsetX + i * cell, y = half - offsetY + i * cell;
      context.moveTo(x, 0); context.lineTo(x, size); context.moveTo(0, y); context.lineTo(size, y);
    }
    context.stroke();
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
    position.col = (position.col + driftSpeed.col * dt + columns) % columns;
    position.row = (position.row + driftSpeed.row * dt + rows) % rows;
    paintLens(); paintPointer();
    schedule();
  }
  function schedule() {
    const running = weights && panelOpacity > 0 && !document.hidden && !reduced.matches;
    if (running && !frame) { lastTime = performance.now(); frame = requestAnimationFrame(tick); }
    if (!running && frame) { cancelAnimationFrame(frame); frame = 0; }
  }

  async function load() {
    if (loading || performance.now() < retryAt) return loading;
    loading = (async () => {
      const [meta, buffer] = await Promise.all([
        fetch('encoding-weights.json').then(response => { if (!response.ok) throw Error('The weights could not load.'); return response.json(); }),
        fetch('encoding-weights.bin.gz').then(response => {
          if (!response.ok) throw Error('The weights could not load.');
          return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        })
      ]);
      const values = new Int16Array(buffer);
      if (values.length !== meta.rows * meta.columns || !(meta.scale > 0)) throw Error('The weights could not be read.');
      weights = values; scale = meta.scale; rows = meta.rows; columns = meta.columns;
      position = { col: Math.random() * columns, row: Math.random() * rows };
      paintedSize = 0; paintInside(); layout(); paintLens();
      inside.classList.add('is-ready');
      sync();
    })().catch(error => { loading = null; retryAt = performance.now() + 15000; console.error(error); });
    return loading;
  }

  function sync() {
    panelOpacity = Number(panel.style.opacity) || 0;
    const target = reduced.matches ? Number(panelOpacity >= .5) : panelOpacity * panelOpacity * (3 - 2 * panelOpacity);
    if (enhanced && target !== open) { open = target; paintDoor(); }
    // The lens, its pointer, and the caption follow the opening door.
    const reveal = clamp((open - .55) / .45);
    parts.pointer.setAttribute('opacity', weights ? reveal : 0);
    lens.style.opacity = weights ? reveal : 0;
    caption.style.opacity = reveal;
    if (panelOpacity > 0) { if (enhanced) { paintInside(); layout(); } load(); }
    schedule();
  }
  // Fetch the weights before the reader reaches the panel.
  addEventListener('scroll', () => { if (scrollY > stage.offsetHeight * 1.3) load(); }, { passive: true });
  addEventListener('resize', () => { paintedSize = 0; if (panelOpacity > 0) { paintInside(); layout(); } });
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', () => { sync(); if (weights) paintLens(); });
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['style'] });
  (async () => {
    try { await photo.decode(); } catch { return; }
    box.append(inside); enhanced = true;
    await document.fonts.ready;
    paintDoor(); sync();
    if (weights) paintLens();
  })();
})();
