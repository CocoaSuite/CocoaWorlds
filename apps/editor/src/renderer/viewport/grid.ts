/**
 * Editor grid drawn by a shader on one large plane: anti-aliased minor/major lines, coloured axis lines,
 * and a fade with distance from the camera. Works the same on every GPU (no long line segments to clip).
 */
import * as THREE from 'three';
import type { ViewKind } from './camera';

const SIZE = 131072;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform float uStep;
  uniform int uPlane;          // 0 = XZ (floor), 1 = XY (front), 2 = ZY (side)
  uniform vec3 uCam;
  uniform float uFade;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform vec3 uAxisA;         // colour of the line along the first plane axis
  uniform vec3 uAxisB;
  varying vec3 vWorld;

  vec2 planeCoord(vec3 p) {
    if (uPlane == 1) return p.xy;
    if (uPlane == 2) return p.zy;
    return p.xz;
  }

  float gridLine(vec2 c, float step) {
    vec2 s = c / step;
    vec2 g = abs(fract(s - 0.5) - 0.5) / max(fwidth(s), vec2(1e-5));
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  float axisLine(float v) {
    return 1.0 - min(abs(v) / max(fwidth(v), 1e-5) / 1.25, 1.0);
  }

  void main() {
    vec2 c = planeCoord(vWorld);
    vec2 cam = planeCoord(uCam);
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, length(c - cam));

    float minor = gridLine(c, uStep);
    float major = gridLine(c, uStep * 4.0);
    vec3 col = uMinor;
    float a = minor * 0.55;
    if (major > 0.0) { col = mix(col, uMajor, major); a = max(a, major * 0.9); }

    float ax = axisLine(c.y);   // the line where the second coordinate is zero runs along the first axis
    float bx = axisLine(c.x);
    if (ax > 0.0) { col = mix(col, uAxisA, ax); a = max(a, ax); }
    if (bx > 0.0) { col = mix(col, uAxisB, bx); a = max(a, bx); }

    a *= fade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const X = new THREE.Color(0xff6b5b);
const Y = new THREE.Color(0x8fd14f);
const Z = new THREE.Color(0x4b9cff);

export class EditorGrid {
  readonly object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private step = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uStep: { value: 16 },
        uPlane: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uFade: { value: 8192 },
        uMinor: { value: new THREE.Color(0x3a3a3a) },
        uMajor: { value: new THREE.Color(0x4f4f4f) },
        uAxisA: { value: X.clone() },
        uAxisB: { value: Z.clone() },
      },
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), this.mat);
    this.object.name = 'editor-grid';
    this.object.renderOrder = -1;
    this.object.frustumCulled = false;
    this.orient('perspective');
  }

  /** Choose the grid step for the zoom level: thin out (×4) while cells would be denser than ~6 px. */
  update(gridSize: number, unitsPerPixel: number): void {
    let step = gridSize;
    while (step / unitsPerPixel < 6 && step < 4096) step *= 4;
    this.step = step;
    this.mat.uniforms.uStep!.value = step;
    this.mat.uniforms.uFade!.value = Math.max(2048, unitsPerPixel * 1600);
  }

  get currentStep(): number {
    return this.step;
  }

  /** Called every frame before rendering so the fade follows the camera. */
  setCamera(position: THREE.Vector3): void {
    (this.mat.uniforms.uCam!.value as THREE.Vector3).copy(position);
  }

  /** Lay the grid in the plane the view looks at and colour the axis lines by the world axis they show. */
  orient(view: ViewKind): void {
    const u = this.mat.uniforms;
    this.object.rotation.set(0, 0, 0);
    if (view === 'front') {
      u.uPlane!.value = 1;
      (u.uAxisA!.value as THREE.Color).copy(X);
      (u.uAxisB!.value as THREE.Color).copy(Y);
    } else if (view === 'side') {
      this.object.rotation.y = Math.PI / 2;
      u.uPlane!.value = 2;
      (u.uAxisA!.value as THREE.Color).copy(Z);
      (u.uAxisB!.value as THREE.Color).copy(Y);
    } else {
      this.object.rotation.x = -Math.PI / 2;
      u.uPlane!.value = 0;
      (u.uAxisA!.value as THREE.Color).copy(X);
      (u.uAxisB!.value as THREE.Color).copy(Z);
    }
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.mat.dispose();
  }
}
