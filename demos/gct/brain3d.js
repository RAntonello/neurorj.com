import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

let surfacePromise;
export function loadSurface() {
  if (!surfacePromise) surfacePromise = (async () => {
    async function unzip(path) {
      const response = await fetch(path);
      if (!response.ok) throw Error('The brain surface could not be loaded.');
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    const [bytes, blend, unfold, anatomy] = await Promise.all([
      unzip('brain-surface.bin.gz'), unzip('surface-blend.bin.gz'), unzip('brain-unfold.bin.gz'),
      fetch('brain-unfold.json').then(response => { if (!response.ok) throw Error('The anatomy could not be loaded.'); return response.json(); })
    ]);
    const header = new Uint32Array(bytes, 0, 4);
    if (header[0] !== 0x47435433) throw Error('Invalid cortical surface.');
    const vertices = header[1], count = header[2];
    let offset = 16;
    const positions = new Float32Array(bytes, offset, vertices * 3); offset += vertices * 12;
    const indices = new Uint32Array(bytes, offset, count); offset += count * 4;
    const labels = new Uint16Array(bytes, offset, vertices); offset += vertices * 2;
    offset = Math.ceil(offset / 4) * 4;
    const shades = new Float32Array(bytes, offset, vertices);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const blendHeader = new Uint32Array(blend, 0, 4);
    if (blendHeader[0] !== 0x47435453 || blendHeader[1] !== vertices) throw Error('Invalid surface interpolation.');
    geometry.setAttribute('blendPatches', new THREE.Float32BufferAttribute(new Uint16Array(blend, 16, vertices * 4), 4));
    geometry.setAttribute('blendWeights', new THREE.BufferAttribute(new Uint16Array(blend, 16 + vertices * 8, vertices * 4), 4, true));
    const colors = new Float32Array(vertices * 3);
    for (let i = 0; i < vertices; i++) colors.fill(shades[i], i * 3, i * 3 + 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const unfoldHeader = new Uint32Array(unfold, 0, 4);
    if (unfoldHeader[0] !== 0x47435455 || unfoldHeader[1] !== vertices) throw Error('Invalid unfolding surface.');
    const inflated = new THREE.BufferAttribute(new Float32Array(unfold, 16, vertices * 3), 3);
    const flat = new THREE.BufferAttribute(new Float32Array(unfold, 16 + vertices * 12, vertices * 3), 3);
    geometry.setAttribute('rscMask', new THREE.BufferAttribute(new Uint8Array(unfold, 16 + vertices * 24, vertices), 1));
    const indexOffset = Math.ceil((16 + vertices * 25) / 4) * 4;
    const flatIndex = new THREE.BufferAttribute(new Uint32Array(unfold, indexOffset, unfoldHeader[2]), 1);
    geometry.morphAttributes.position = [inflated, flat];
    geometry.morphAttributes.normal = [inflated, flat].map((position, i) => {
      const surface = new THREE.BufferGeometry();
      surface.setAttribute('position', position); surface.setIndex(i ? flatIndex : geometry.index);
      surface.computeVertexNormals();
      return surface.getAttribute('normal');
    });
    geometry.userData = { originalIndex: geometry.index, flatIndex, anatomy };
    return geometry;
  })().catch(error => { surfacePromise = null; throw error; });
  return surfacePromise;
}

export class BrainView {
  constructor(canvas, geometry, data) {
    this.canvas = canvas; this.data = data;
    this.geometry = geometry; this.unfold = 0; this.highlight = { value: 0 };
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-140, 140, 105, -105, 1, 1500);
    this.camera.position.set(-265, 70, 175); this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, .7));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-160, 230, 250); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xf4f6ff, .7); fill.position.set(200, 20, -180); this.scene.add(fill);
    this.texels = new Float32Array(801 * 4);
    this.texture = new THREE.DataTexture(this.texels, 801, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .82, metalness: 0, side: THREE.DoubleSide });
    // Interpolate signed response values over the surface BEFORE applying color.
    // The kernel follows mesh edges, never jumping across sulci or hemispheres.
    material.onBeforeCompile = shader => {
      shader.uniforms.responseTexture = { value: this.texture };
      shader.uniforms.coolColor = { value: new THREE.Color('#3c83c4') };
      shader.uniforms.warmColor = { value: new THREE.Color('#e86632') };
      shader.uniforms.rscColor = { value: new THREE.Color('#d46735') };
      shader.uniforms.rscHighlight = this.highlight;
      shader.vertexShader = 'attribute vec4 blendPatches;\nattribute vec4 blendWeights;\nattribute float rscMask;\nuniform sampler2D responseTexture;\nvarying float responseValue;\nvarying float regionMask;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        vec4 samples = vec4(
          texture2D(responseTexture, vec2((blendPatches.x + .5) / 801., .5)).r,
          texture2D(responseTexture, vec2((blendPatches.y + .5) / 801., .5)).r,
          texture2D(responseTexture, vec2((blendPatches.z + .5) / 801., .5)).r,
          texture2D(responseTexture, vec2((blendPatches.w + .5) / 801., .5)).r);
        responseValue = dot(samples, blendWeights);
        regionMask = rscMask;
      `);
      shader.fragmentShader = 'varying float responseValue;\nvarying float regionMask;\nuniform vec3 coolColor;\nuniform vec3 warmColor;\nuniform vec3 rscColor;\nuniform float rscHighlight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(vec3(1.), responseValue > 0. ? warmColor : coolColor, min(abs(responseValue) / 2., 1.) * .95 * (1. - rscHighlight));
        diffuseColor.rgb = mix(diffuseColor.rgb, rscColor, smoothstep(.2, .8, regionMask) * rscHighlight);
      `);
    };
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false; this.controls.enableZoom = false;
    this.controls.enableDamping = false; this.controls.rotateSpeed = .65;
    this.controls.addEventListener('change', () => this.render());
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.onKey = e => {
      if (!this.controls.enabled) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Home') this.controls.reset();
      else {
        const sph = new THREE.Spherical().setFromVector3(this.camera.position);
        if (e.key === 'ArrowLeft') sph.theta -= .15;
        if (e.key === 'ArrowRight') sph.theta += .15;
        if (e.key === 'ArrowUp') sph.phi = Math.max(.1, sph.phi - .15);
        if (e.key === 'ArrowDown') sph.phi = Math.min(Math.PI - .1, sph.phi + .15);
        this.camera.position.setFromSpherical(sph); this.controls.update(); this.render();
      }
    };
    canvas.addEventListener('keydown', this.onKey);
    this.resize();
  }
  resize() {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.updateProjection();
    this.renderer.setSize(width, height, false); this.render();
  }
  updateProjection() {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const normalHeight = 105 * Math.max(1, 1 / aspect);
    const [flatWidth, flatHeight] = this.geometry.userData.anatomy.flatSize;
    const mapHeight = Math.max(flatHeight / 2, flatWidth / (2 * aspect)) * 1.14;
    const halfHeight = THREE.MathUtils.lerp(normalHeight, mapHeight, this.unfold);
    this.camera.left = -halfHeight * aspect; this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }
  setUnfold(amount, highlight) {
    if (amount === this.unfold && highlight === this.highlight.value) return;
    if (amount > 0 && this.unfold === 0) {
      this.foldedCamera = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() };
      this.geometry.setIndex(this.geometry.userData.flatIndex);
    }
    this.unfold = amount; this.highlight.value = highlight;
    const inflation = THREE.MathUtils.smoothstep(amount, 0, .45);
    const flattening = THREE.MathUtils.smoothstep(amount, .25, 1);
    this.mesh.morphTargetInfluences[0] = inflation * (1 - flattening);
    this.mesh.morphTargetInfluences[1] = flattening;
    this.controls.enabled = amount === 0;
    if (amount > 0) {
      const orientation = THREE.MathUtils.smoothstep(amount, 0, .8);
      this.camera.position.copy(this.foldedCamera.position).lerp(new THREE.Vector3(0, 0, 400), orientation);
      this.camera.lookAt(0, 0, 0);
    } else if (this.foldedCamera) {
      this.camera.position.copy(this.foldedCamera.position); this.camera.quaternion.copy(this.foldedCamera.quaternion);
      this.geometry.setIndex(this.geometry.userData.originalIndex);
    }
    this.updateProjection(); this.render();
  }
  render() {
    this.renderer.render(this.scene, this.camera);
    if (this.onRender) {
      this.onRender(this.geometry.userData.anatomy.flatRscCenters.map(center => {
        const p = new THREE.Vector3(...center).project(this.camera);
        return { x: (p.x + 1) * this.canvas.clientWidth / 2, y: (1 - p.y) * this.canvas.clientHeight / 2 };
      }));
    }
  }
  paint(values) {
    for (let i = 0; i < 800; i++) {
      this.texels[i * 4] = values && this.data.corr[i] >= this.data.corrMin ? values[i] : 0;
    }
    // Patch 800 is the unmodeled medial wall; it always stays neutral.
    this.texture.needsUpdate = true; this.render();
  }
  dispose() { this.canvas.removeEventListener('keydown', this.onKey); this.observer.disconnect(); this.controls.dispose(); this.material.dispose(); this.texture.dispose(); this.renderer.dispose(); }
}
