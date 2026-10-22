import {
  LinearSRGBColorSpace,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * La peinture, posée plein écran, puis aspirée par l’orbe : elle se grise, s’enroule autour du
 * centre de l’orbe et s’y effondre, en ouvrant au milieu un trou qui laisse paraître le noir.
 */
const fragmentShader = /* glsl */ `
  uniform vec2 uViewport;
  uniform vec2 uCenter;
  uniform sampler2D uCurrent;
  uniform vec2 uCurrentSize;
  uniform sampler2D uNext;
  uniform vec2 uNextSize;
  uniform float uMix;
  uniform float uCollapse;
  uniform float uGray;
  uniform float uVeil;
  uniform vec3 uRim;
  varying vec2 vUv;

  // Une image aux proportions voisines de l’écran le remplit ; les autres s’y posent comme une
  // toile, avec une ombre, sur un fond tiré de leur propre flou (mipmaps).
  vec3 painting(sampler2D tex, vec2 size, vec2 p) {
    vec2 view = uViewport;
    float cover = max(view.x / size.x, view.y / size.y);
    float contain = min(view.x / size.x, view.y / size.y);
    float fit = cover / contain < 1.22 ? cover : contain * 0.9;
    vec2 local = (p - view * 0.5) / (size * fit);
    vec3 backdrop = texture2D(tex, (p - view * 0.5) / (size * cover * 1.1) + 0.5, 6.5).rgb * 0.3;
    vec2 outside = max(abs(p - view * 0.5) - size * fit * 0.5, 0.0);
    backdrop *= 1.0 - 0.6 * exp(-length(outside) / (0.03 * min(view.x, view.y)));
    float pixel = 1.0 / min(size.x * fit, size.y * fit);
    float inside = 1.0 - smoothstep(0.5 - pixel, 0.5, max(abs(local.x), abs(local.y)));
    return mix(backdrop, texture2D(tex, local + 0.5).rgb, inside);
  }

  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uViewport;
    vec2 d = p - uCenter;
    float reach = length(max(uCenter, uViewport - uCenter));
    float r = length(d) / reach;
    float fall = uCollapse;
    float scale = max(1.0 - fall, 0.0001);
    float source = r / scale;
    // Tourbillon : plus on est près de l’orbe, plus la toile s’enroule.
    float angle = atan(d.y, d.x) - fall * (1.4 + 7.0 * exp(-source * 1.8));
    vec2 q = uCenter + vec2(cos(angle), sin(angle)) * source * reach;
    // Bord de la toile qui rétrécit, en pixels d’écran : au-delà, le noir du miroir.
    float edge = min(min(q.x, uViewport.x - q.x), min(q.y, uViewport.y - q.y)) * scale;
    // Le trou s’ouvre flou derrière l’orbe, puis son bord se précise en grandissant.
    float hole = fall * 0.26;
    float holeEdge = 0.08 - fall * 0.06;
    float visible = smoothstep(-0.75, 0.75, edge) * smoothstep(hole - holeEdge, hole, r);

    vec3 color = mix(painting(uCurrent, uCurrentSize, q), painting(uNext, uNextSize, q), uMix);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luma) * (1.0 - 0.3 * fall), uGray);

    // Lueur froide au bord de la toile et au bord du trou, le temps de la chute.
    float lit = smoothstep(0.0, 0.2, fall) * (1.0 - smoothstep(0.8, 1.0, fall));
    float glow = exp(-abs(edge) / 18.0) * 0.5 + exp(-abs(r - hole) * reach / 10.0) * smoothstep(0.08, 0.2, hole);
    gl_FragColor = vec4((color * visible + uRim * glow * lit * 0.45) * uVeil, 1.0);
  }
`;

export interface ScreensaverFrame {
  width: number;
  height: number;
  center: { x: number; y: number };
  collapse: number;
  gray: number;
  veil: number;
  mix: number;
}

export type ScreensaverSlot = 'current' | 'next';

/** Une seule surface plein écran ; rien n’est dessiné entre deux changements. */
export function createScreensaverRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    powerPreference: 'low-power',
  });
  // Couleurs telles quelles, de l’image à l’écran : le shader ne fait aucune conversion.
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uViewport: { value: new Vector2(1, 1) },
    uCenter: { value: new Vector2() },
    uCurrent: { value: null as Texture | null },
    uCurrentSize: { value: new Vector2(1, 1) },
    uNext: { value: null as Texture | null },
    uNextSize: { value: new Vector2(1, 1) },
    uMix: { value: 0 },
    uCollapse: { value: 0 },
    uGray: { value: 0 },
    uVeil: { value: 1 },
    uRim: { value: new Vector3(0.55, 0.68, 1) },
  };
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new Mesh(geometry, material));
  const textures: Record<ScreensaverSlot, Texture | null> = { current: null, next: null };
  const release = (texture: Texture | null) => {
    texture?.dispose();
    (texture?.image as ImageBitmap | undefined)?.close();
  };

  return {
    resize(width: number, height: number, ratio: number) {
      renderer.setPixelRatio(Math.min(ratio, 2, Math.sqrt(4_000_000 / (width * height))));
      renderer.setSize(width, height, false);
    },
    /** Remplace l’image d’un emplacement ; le moteur garde l’image et libère l’ancienne. */
    set(slot: ScreensaverSlot, bitmap: ImageBitmap | null) {
      release(textures[slot]);
      textures[slot] = null;
      if (!bitmap) return;
      const texture = new Texture(bitmap);
      texture.colorSpace = NoColorSpace;
      texture.needsUpdate = true;
      textures[slot] = texture;
      (slot === 'current' ? uniforms.uCurrentSize : uniforms.uNextSize).value.set(
        bitmap.width,
        bitmap.height,
      );
    },
    /** L’image suivante devient l’image affichée, après un fondu. */
    promote() {
      release(textures.current);
      textures.current = textures.next;
      textures.next = null;
      uniforms.uCurrentSize.value.copy(uniforms.uNextSize.value);
    },
    render(frame: ScreensaverFrame) {
      if (!textures.current) return;
      uniforms.uViewport.value.set(frame.width, frame.height);
      uniforms.uCenter.value.set(frame.center.x, frame.center.y);
      uniforms.uCurrent.value = textures.current;
      uniforms.uNext.value = textures.next ?? textures.current;
      uniforms.uMix.value = textures.next ? frame.mix : 0;
      uniforms.uCollapse.value = frame.collapse;
      uniforms.uGray.value = frame.gray;
      uniforms.uVeil.value = frame.veil;
      renderer.render(scene, camera);
    },
    dispose() {
      release(textures.current);
      release(textures.next);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
