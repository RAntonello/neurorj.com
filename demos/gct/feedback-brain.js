import * as THREE from './vendor/three.module.js';
import { BrainView, loadSurface } from './brain3d.js';

export async function createFeedbackBrain(canvas, annotate) {
  const source = await loadSurface();
  // Open the sulci slightly so the functional RSC mask is visible from the
  // medial side. Vertex correspondence and the mask itself remain unchanged.
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.setAttribute(name, attribute);
  }
  const pial = source.getAttribute('position'), inflated = source.morphAttributes.position[0];
  const displayed = new Float32Array(pial.array.length);
  for (let i = 0; i < displayed.length; i++) displayed[i] = THREE.MathUtils.lerp(pial.array[i], inflated.array[i], .35);
  geometry.setAttribute('position', new THREE.BufferAttribute(displayed, 3));
  const leftVertices = source.userData.anatomy.leftVertices;
  const original = source.userData.originalIndex.array, triangles = [];
  for (let i = 0; i < original.length; i += 3) {
    if (original[i] < leftVertices && original[i + 1] < leftVertices && original[i + 2] < leftVertices) {
      triangles.push(original[i], original[i + 1], original[i + 2]);
    }
  }
  geometry.setIndex(new THREE.Uint32BufferAttribute(triangles, 1));
  // Independent positions, normals, and indices protect the opening brain and
  // its unfolding animation from changes to this partially inflated view.
  geometry.computeVertexNormals();
  geometry.userData = { anatomy: source.userData.anatomy };
  const position = geometry.getAttribute('position'), bounds = new THREE.Box3(), vertex = new THREE.Vector3();
  for (let i = 0; i < leftVertices; i++) bounds.expandByPoint(vertex.fromBufferAttribute(position, i));
  const view = new BrainView(canvas, geometry, {});
  bounds.getCenter(view.controls.target);
  view.camera.position.copy(view.controls.target).add(new THREE.Vector3(288, 20, 55));
  view.camera.lookAt(view.controls.target);
  view.camera.zoom = 1.16;
  view.controls.update(); view.controls.saveState();
  const light = new THREE.DirectionalLight(0xffffff, 1.3);
  light.position.set(220, 100, 100); view.scene.add(light);
  view.highlight.value = 1;
  // This is an anatomical highlight, not a measured response to the example.
  const center = new THREE.Vector3();
  const mask = geometry.getAttribute('rscMask'); let count = 0;
  for (let i = 0; i < leftVertices; i++) if (mask.getX(i)) {
    center.add(vertex.fromBufferAttribute(position, i)); count++;
  }
  center.divideScalar(count);
  const render = view.render.bind(view);
  view.render = () => {
    render();
    const point = center.clone().project(view.camera);
    annotate({ x: (point.x + 1) * canvas.clientWidth / 2, y: (1 - point.y) * canvas.clientHeight / 2 });
  };
  view.resize();
  return view;
}
