import * as THREE from '../gct/vendor/three.module.js';
import { OrbitControls } from '../gct/vendor/OrbitControls.js';

const PATCH_COUNT = 800;
const TEXTURE_WIDTH = PATCH_COUNT + 1;
const ROTATION_SPEED = .035;
const INTERACTION_PAUSE = 6000;
const UNFOLD_DURATION = 1800;
const INITIAL_POSITION = new THREE.Vector3(-265, 70, 175);

async function readCompressedAsset(filename, signal) {
  const response = await fetch(new URL(`../gct/${filename}`, import.meta.url), { signal });
  if (!response.ok) throw new Error('The brain surface could not be loaded.');
  if (!response.body || typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open the brain surface. Please use a current browser.');
  }
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

async function loadGeometry(signal) {
  // The folded cortex needs neither the tutorial's unfolding geometry nor its ROI data.
  const [surface, blend] = await Promise.all([
    readCompressedAsset('brain-surface.bin.gz', signal),
    readCompressedAsset('surface-blend.bin.gz', signal)
  ]);
  const header = new Uint32Array(surface, 0, 4);
  if (header[0] !== 0x47435433 || header[3] !== PATCH_COUNT) {
    throw new Error('Invalid cortical surface.');
  }
  const vertices = header[1], indexCount = header[2];
  let offset = 16;
  const positions = new Float32Array(surface, offset, vertices * 3);
  offset += vertices * 12;
  const indices = new Uint32Array(surface, offset, indexCount);
  offset += indexCount * 4 + vertices * 2; // Skip the original discrete patch labels.
  offset = Math.ceil(offset / 4) * 4;
  const shades = new Float32Array(surface, offset, vertices);
  const blendHeader = new Uint32Array(blend, 0, 4);
  if (blendHeader[0] !== 0x47435453 || blendHeader[1] !== vertices) {
    throw new Error('Invalid surface interpolation.');
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('blendPatches', new THREE.Float32BufferAttribute(
    new Uint16Array(blend, 16, vertices * 4), 4
  ));
  geometry.setAttribute('blendWeights', new THREE.BufferAttribute(
    new Uint16Array(blend, 16 + vertices * 8, vertices * 4), 4, true
  ));
  const colors = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) {
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shades[i];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadUnfoldData(geometry, signal) {
  const [bytes, anatomy] = await Promise.all([
    readCompressedAsset('brain-unfold.bin.gz', signal),
    fetch(new URL('../gct/brain-unfold.json', import.meta.url), { signal }).then(response => {
      if (!response.ok) throw new Error('The unfolded brain could not be loaded.');
      return response.json();
    })
  ]);
  const header = new Uint32Array(bytes, 0, 4);
  const vertices = geometry.getAttribute('position').count;
  if (header[0] !== 0x47435455 || header[1] !== vertices || !header[2] || header[2] % 3 !== 0
      || header[2] > geometry.index.count || anatomy.vertices !== vertices
      || !Array.isArray(anatomy.flatSize) || anatomy.flatSize.length < 2
      || !anatomy.flatSize.slice(0, 2).every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid unfolding surface.');
  }
  const inflated = new THREE.BufferAttribute(new Float32Array(bytes, 16, vertices * 3), 3);
  const flat = new THREE.BufferAttribute(new Float32Array(bytes, 16 + vertices * 12, vertices * 3), 3);
  // The source file also contains an ROI mask; skip it without adding a highlight.
  const indexOffset = Math.ceil((16 + vertices * 25) / 4) * 4;
  const flatIndex = new THREE.BufferAttribute(new Uint32Array(bytes, indexOffset, header[2]), 1);
  const normals = [inflated, flat].map((position, index) => {
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', position);
    surface.setIndex(index ? flatIndex : geometry.index);
    surface.computeVertexNormals();
    const normal = surface.getAttribute('normal');
    surface.dispose();
    return normal;
  });
  let inflatedRadiusSquared = 0;
  const flatExtents = new THREE.Vector3(anatomy.flatSize[0] / 2, anatomy.flatSize[1] / 2, 0);
  for (let i = 0; i < vertices * 3; i += 3) {
    const p = inflated.array;
    inflatedRadiusSquared = Math.max(inflatedRadiusSquared, p[i] ** 2 + p[i + 1] ** 2 + p[i + 2] ** 2);
    flatExtents.x = Math.max(flatExtents.x, Math.abs(flat.array[i]));
    flatExtents.y = Math.max(flatExtents.y, Math.abs(flat.array[i + 1]));
    flatExtents.z = Math.max(flatExtents.z, Math.abs(flat.array[i + 2]));
  }
  return { inflated, flat, normals, flatIndex, flatExtents, inflatedRadius: Math.sqrt(inflatedRadiusSquared) };
}

function createMaterial(texture) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: .82,
    metalness: 0,
    side: THREE.DoubleSide
  });
  // Match the tutorial: interpolate signed responses along the cortical mesh,
  // then map the continuous result to color. Unmodeled tissue remains neutral.
  material.onBeforeCompile = shader => {
    shader.uniforms.responseTexture = { value: texture };
    shader.uniforms.coolColor = { value: new THREE.Color('#3c83c4') };
    shader.uniforms.warmColor = { value: new THREE.Color('#e86632') };
    shader.vertexShader = `
      attribute vec4 blendPatches;
      attribute vec4 blendWeights;
      uniform sampler2D responseTexture;
      varying float responseValue;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `
      #include <color_vertex>
      vec4 samples = vec4(
        texture2D(responseTexture, vec2((blendPatches.x + .5) / 801., .5)).r,
        texture2D(responseTexture, vec2((blendPatches.y + .5) / 801., .5)).r,
        texture2D(responseTexture, vec2((blendPatches.z + .5) / 801., .5)).r,
        texture2D(responseTexture, vec2((blendPatches.w + .5) / 801., .5)).r);
      responseValue = dot(samples, blendWeights);
    `);
    shader.fragmentShader = `
      varying float responseValue;
      uniform vec3 coolColor;
      uniform vec3 warmColor;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb *= mix(vec3(1.), responseValue > 0. ? warmColor : coolColor,
        min(abs(responseValue) / 2., 1.) * .95);
    `);
  };
  return material;
}

/**
 * Create the folded cortical viewer without loading an encoding model.
 * `paint` accepts 800 signed patch responses (or null for a neutral brain).
 * The caller owns response timing; the viewer animates its camera and surface.
 */
export async function createBrainView(canvas, {
  corr = null,
  corrMin = 0,
  autoRotate = true,
  onInteraction,
  onError,
  signal
} = {}) {
  if (corr != null && corr.length !== PATCH_COUNT) {
    throw new RangeError('The brain viewer needs 800 patch correlations.');
  }
  corrMin = Number.isFinite(corrMin) ? corrMin : 0;
  const geometry = await loadGeometry(signal);
  if (signal?.aborted) {
    geometry.dispose();
    throw new DOMException('Brain loading was cancelled.', 'AbortError');
  }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    geometry.dispose();
    throw error;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-140, 140, 105, -105, 1, 1500);
  camera.position.copy(INITIAL_POSITION);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, .7));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-160, 230, 250);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xf4f6ff, .7);
  fill.position.set(200, 20, -180);
  scene.add(fill);

  const texels = new Float32Array(TEXTURE_WIDTH * 4);
  const texture = new THREE.DataTexture(texels, TEXTURE_WIDTH, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  const material = createMaterial(texture);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = false;
  controls.rotateSpeed = .65;
  controls.minPolarAngle = .1;
  controls.maxPolarAngle = Math.PI - .1;
  controls.saveState();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();
  const viewRight = new THREE.Vector3(), viewUp = new THREE.Vector3();
  const flatOrientation = new THREE.Quaternion();
  const foldedRadius = geometry.boundingSphere.radius;
  const responses = new Float32Array(PATCH_COUNT);
  let disposed = false, contextLost = false, inView = true, interacting = false;
  let frameId = 0, renderFrameId = 0, resumeTimer = 0, lastTick = 0, pausedUntil = 0;
  let hasSize = false;
  let unfoldData = null, unfoldPromise = null, unfoldController = null;
  let unfoldAmount = 0, foldedPose = null, flatTopology = false, originalIndices = null;
  let transition = null, morphFrameId = 0;

  function canRender() {
    return !disposed && !contextLost && hasSize && inView && !document.hidden;
  }

  function render() {
    // Response playback and camera movement can both update in the same frame.
    // Commit their latest state together instead of drawing the cortex twice.
    if (!canRender() || renderFrameId) return;
    renderFrameId = requestAnimationFrame(() => {
      renderFrameId = 0;
      if (canRender()) renderer.render(scene, camera);
    });
  }

  function cancelRender() {
    cancelAnimationFrame(renderFrameId);
    renderFrameId = 0;
  }

  function rotate(horizontal, vertical = 0) {
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    spherical.theta += horizontal;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + vertical, .1, Math.PI - .1);
    camera.position.setFromSpherical(spherical).add(controls.target);
    controls.update(); // Its change event renders the new camera position.
  }

  function canRotate() {
    return autoRotate && !disposed && !contextLost && inView && hasSize
      && !interacting && !document.hidden && !reducedMotion.matches
      && !transition && unfoldAmount === 0;
  }

  function stopRotation() {
    cancelAnimationFrame(frameId);
    clearTimeout(resumeTimer);
    frameId = resumeTimer = lastTick = 0;
  }

  function scheduleRotation() {
    if (!canRotate()) {
      stopRotation();
      return;
    }
    const wait = pausedUntil - performance.now();
    if (wait > 0) {
      stopRotation();
      resumeTimer = setTimeout(() => {
        resumeTimer = 0;
        scheduleRotation();
      }, wait);
    } else if (!frameId) {
      lastTick = 0;
      frameId = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    frameId = 0;
    if (!canRotate() || now < pausedUntil) {
      scheduleRotation();
      return;
    }
    const elapsed = lastTick ? Math.min((now - lastTick) / 1000, .05) : 0;
    lastTick = now;
    if (elapsed > 0) rotate(ROTATION_SPEED * elapsed);
    frameId = requestAnimationFrame(tick);
  }

  function noteInteraction() {
    pausedUntil = performance.now() + INTERACTION_PAUSE;
    stopRotation();
    onInteraction?.();
  }

  function onStart() {
    interacting = true;
    noteInteraction();
  }

  function onEnd() {
    interacting = false;
    pausedUntil = performance.now() + INTERACTION_PAUSE;
    scheduleRotation();
  }

  function reset() {
    if (disposed || transition || unfoldAmount !== 0) return;
    noteInteraction();
    controls.reset();
    render();
    scheduleRotation();
  }

  function onKey(event) {
    if (disposed || !controls.enabled || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      reset();
      return;
    }
    noteInteraction();
    if (event.key === 'ArrowLeft') rotate(-.15);
    if (event.key === 'ArrowRight') rotate(.15);
    if (event.key === 'ArrowUp') rotate(0, -.15);
    if (event.key === 'ArrowDown') rotate(0, .15);
    scheduleRotation();
  }

  function updateProjection() {
    if (!hasSize) return;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    let halfHeight = foldedRadius * Math.max(1, 1 / aspect);
    if (unfoldData && unfoldAmount > 0) {
      const [inflatedWeight, flatWeight] = mesh.morphTargetInfluences;
      const pialWeight = 1 - inflatedWeight - flatWeight;
      const roundExtent = foldedRadius * pialWeight + unfoldData.inflatedRadius * inflatedWeight;
      viewRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      viewUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const extents = unfoldData.flatExtents;
      const projectExtent = axis => Math.abs(axis.x) * extents.x
        + Math.abs(axis.y) * extents.y + Math.abs(axis.z) * extents.z;
      // A weighted bound on all three surfaces also fits the intermediate morphs,
      // including when the starting camera faces the underside of the cortex.
      halfHeight = Math.max(roundExtent + flatWeight * projectExtent(viewUp),
        (roundExtent + flatWeight * projectExtent(viewRight)) / aspect);
    }
    halfHeight *= 1.12;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function resize() {
    if (disposed) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    hasSize = width > 0 && height > 0;
    if (!hasSize) {
      stopRotation();
      pauseMorph();
      return;
    }
    updateProjection();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setSize(width, height, false);
    render();
    scheduleRotation();
    scheduleMorph();
  }

  function ensureUnfoldData() {
    if (unfoldData) return Promise.resolve();
    if (unfoldPromise) return unfoldPromise;
    const controller = new AbortController();
    unfoldController = controller;
    unfoldPromise = loadUnfoldData(geometry, controller.signal).then(data => {
      if (disposed) throw new DOMException('The brain viewer was closed.', 'AbortError');
      originalIndices = geometry.index.array.slice();
      geometry.morphAttributes.position = [data.inflated, data.flat];
      geometry.morphAttributes.normal = data.normals;
      mesh.updateMorphTargets();
      material.needsUpdate = true;
      unfoldData = data;
    }).catch(error => {
      controller.abort();
      unfoldPromise = null;
      throw error;
    }).finally(() => {
      if (unfoldController === controller) unfoldController = null;
    });
    return unfoldPromise;
  }

  function setTopology(flat) {
    if (flatTopology === flat) return;
    // Reuse one GPU index buffer. Only the cut topology and draw count change;
    // folding restores every original triangle without orphaning GPU buffers.
    geometry.index.array.set(flat ? unfoldData.flatIndex.array : originalIndices);
    geometry.index.needsUpdate = true;
    geometry.setDrawRange(0, flat ? unfoldData.flatIndex.count : originalIndices.length);
    flatTopology = flat;
  }

  function applyUnfold(amount) {
    unfoldAmount = amount;
    const inflation = THREE.MathUtils.smoothstep(amount, 0, .45);
    const flattening = THREE.MathUtils.smoothstep(amount, .25, 1);
    mesh.morphTargetInfluences[0] = inflation * (1 - flattening);
    mesh.morphTargetInfluences[1] = flattening;
    setTopology(amount > 0);
    if (amount > 0) {
      const orientation = THREE.MathUtils.smoothstep(amount, 0, .8);
      camera.quaternion.copy(foldedPose.quaternion).slerp(flatOrientation, orientation);
      const radius = THREE.MathUtils.lerp(foldedPose.radius, 400, orientation);
      camera.position.set(0, 0, radius).applyQuaternion(camera.quaternion);
      camera.up.copy(foldedPose.up).lerp(new THREE.Vector3(0, 1, 0), orientation);
    } else {
      camera.position.copy(foldedPose.position);
      camera.quaternion.copy(foldedPose.quaternion);
      camera.up.copy(foldedPose.up);
      controls.target.copy(foldedPose.target);
    }
    updateProjection();
    render();
  }

  function pauseMorph() {
    cancelAnimationFrame(morphFrameId);
    morphFrameId = 0;
    if (transition) transition.lastTime = 0;
  }

  function finishTransition(operation) {
    if (transition !== operation || disposed) return;
    applyUnfold(operation.target);
    pauseMorph();
    transition = null;
    controls.enabled = unfoldAmount === 0;
    if (unfoldAmount === 0) {
      foldedPose = null;
      pausedUntil = performance.now() + INTERACTION_PAUSE;
    }
    scheduleRotation();
    operation.resolve();
  }

  function scheduleMorph() {
    if (!transition?.ready) return;
    if (reducedMotion.matches) {
      finishTransition(transition);
    } else if (!canRender()) {
      pauseMorph();
    } else if (!morphFrameId) {
      morphFrameId = requestAnimationFrame(tickMorph);
    }
  }

  function tickMorph(now) {
    morphFrameId = 0;
    const operation = transition;
    if (!operation?.ready) return;
    if (!canRender() || reducedMotion.matches) {
      scheduleMorph();
      return;
    }
    if (operation.lastTime) operation.elapsed += Math.min(now - operation.lastTime, 50);
    operation.lastTime = now;
    const progress = Math.min(operation.elapsed / operation.duration, 1);
    const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
    applyUnfold(THREE.MathUtils.lerp(operation.from, operation.target, eased));
    if (progress === 1) finishTransition(operation);
    else scheduleMorph();
  }

  function cancelTransition(error) {
    if (!transition) return;
    const operation = transition;
    pauseMorph();
    transition = null;
    controls.enabled = unfoldAmount === 0;
    operation.reject(error);
  }

  function setUnfolded(unfolded) {
    if (disposed) return Promise.reject(new DOMException('The brain viewer was closed.', 'AbortError'));
    const target = unfolded ? 1 : 0;
    if (transition?.target === target) return transition.promise;
    cancelTransition(new DOMException('The surface transition was replaced.', 'AbortError'));
    if (unfoldAmount === target) {
      scheduleRotation();
      return Promise.resolve();
    }
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    const operation = { target, promise, resolve, reject, ready: false, lastTime: 0, elapsed: 0 };
    transition = operation;
    controls.enabled = false;
    interacting = false;
    noteInteraction();
    Promise.resolve().then(async () => {
      if (target) await ensureUnfoldData();
      if (disposed || transition !== operation) return;
      if (unfoldAmount === 0) {
        foldedPose = {
          position: camera.position.clone(), quaternion: camera.quaternion.clone(),
          up: camera.up.clone(), target: controls.target.clone(),
          radius: camera.position.distanceTo(controls.target)
        };
      }
      operation.from = unfoldAmount;
      operation.duration = UNFOLD_DURATION * Math.abs(target - unfoldAmount);
      operation.ready = true;
      scheduleMorph();
    }).catch(error => {
      if (transition !== operation) return;
      cancelTransition(error);
      if (unfoldAmount === 0) foldedPose = null;
      scheduleRotation();
    });
    return promise;
  }

  function applyResponses() {
    let changed = false;
    for (let i = 0; i < PATCH_COUNT; i++) {
      const value = (!corr || corr[i] >= corrMin) ? responses[i] : 0;
      if (texels[i * 4] !== value) {
        texels[i * 4] = value;
        changed = true;
      }
    }
    // Texture entry 800, the unmodeled medial wall, is always zero.
    if (changed) {
      texture.needsUpdate = true;
      render();
    }
  }

  function paint(values) {
    if (disposed) return;
    if (values != null && values.length !== PATCH_COUNT) {
      throw new RangeError('The brain viewer needs 800 patch responses.');
    }
    for (let i = 0; i < PATCH_COUNT; i++) {
      responses[i] = values && Number.isFinite(values[i]) ? values[i] : 0;
    }
    applyResponses();
  }

  function setCorrelation(nextCorrelation, minimum = corrMin) {
    if (disposed) return;
    if (nextCorrelation != null && nextCorrelation.length !== PATCH_COUNT) {
      throw new RangeError('The brain viewer needs 800 patch correlations.');
    }
    corr = nextCorrelation;
    corrMin = Number.isFinite(minimum) ? minimum : 0;
    applyResponses();
  }

  function onVisibility() {
    if (document.hidden) cancelRender();
    else render();
    scheduleRotation();
    scheduleMorph();
  }

  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stopRotation();
    cancelRender();
    pauseMorph();
    onError?.(new Error('The 3D brain lost its graphics connection.'));
  }

  function onContextRestored() {
    if (disposed) return;
    contextLost = false;
    texture.needsUpdate = true;
    resize();
  }

  function onMotionPreference() {
    scheduleRotation();
    scheduleMorph();
  }

  controls.addEventListener('change', render);
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  document.addEventListener('visibilitychange', onVisibility);
  reducedMotion.addEventListener('change', onMotionPreference);
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  if (!canvas.hasAttribute('aria-label')) {
    canvas.setAttribute('aria-label', '3D brain. Use arrow keys to rotate and Home to reset the view.');
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersectionObserver = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (inView) render();
    else cancelRender();
    scheduleRotation();
    scheduleMorph();
  });
  intersectionObserver.observe(canvas);

  resize();
  return {
    paint,
    render,
    reset,
    resize,
    setCorrelation,
    setUnfolded,
    get isUnfolded() { return unfoldAmount === 1; },
    get isTransitioning() { return transition !== null; },
    setAutoRotate(enabled) {
      autoRotate = Boolean(enabled);
      scheduleRotation();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopRotation();
      cancelRender();
      cancelTransition(new DOMException('The brain viewer was closed.', 'AbortError'));
      unfoldController?.abort();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', onMotionPreference);
      controls.removeEventListener('change', render);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    }
  };
}
