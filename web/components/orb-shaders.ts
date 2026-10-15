export const orbVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uSpeech;
  uniform float uTwist;
  uniform float uFlow;
  uniform vec2 uStretch;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vSurface;

  vec3 deform(vec3 p) {
    float waves = sin(p.x * 3.1 + uTime * 0.65) * sin(p.y * 2.7 - uTime * 0.48)
      + 0.5 * sin(p.z * 3.5 + p.y * 1.8 + uTime * 0.55);
    p *= 1.0 + waves * (0.055 + uEnergy * 0.035)
      + uSpeech * 0.07 * sin(p.y * 4.0 + uTime * 2.0);
    float twist = uTwist * (p.y * 0.95 + sin(p.y * 2.3 - uFlow) * 0.32);
    p.xz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * p.xz;
    p.x += uTwist * 0.17 * sin(p.y * 3.0 - uFlow) * max(0.0, 1.0 - p.y * p.y);
    p.y += uTwist * 0.08 * sin(p.x * 3.5 + uFlow);
    p.x *= 1.0 + (uStretch.x - 1.0) * (0.7 + 0.3 * p.y);
    p.y *= 1.0 + (uStretch.y - 1.0) * (0.7 + 0.3 * p.x);
    return p;
  }

  void main() {
    vec3 n = normalize(position);
    vec3 tangent = normalize(cross(abs(n.y) > 0.9 ? vec3(1,0,0) : vec3(0,1,0), n));
    vec3 bitangent = normalize(cross(n, tangent));
    vec3 p = deform(position);
    // Recompute normals on the deformed skin so the light bends with the material.
    vec3 dt = deform(position + tangent * 0.004) - p;
    vec3 db = deform(position + bitangent * 0.004) - p;
    vNormal = normalize(normalMatrix * normalize(cross(dt, db)));
    vSurface = p;
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vViewPosition = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

export const orbFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uSpeech;
  uniform float uShimmer;
  uniform float uWebSearch;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vSurface;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 view = normalize(vViewPosition);
    float facing = max(dot(n, view), 0.0);
    float fresnel = pow(1.0 - facing, 2.5);
    vec3 light = normalize(vec3(-0.7, 0.85, 1.4));
    float diffuse = max(dot(n, light), 0.0);
    float reflection = pow(max(dot(n, normalize(light + view)), 0.0), 56.0);
    float broadReflection = pow(max(dot(n, normalize(vec3(0.8, -0.5, 1.1))), 0.0), 12.0);
    float current = 0.5 + 0.5 * sin(vSurface.y * 4.0 + vSurface.x * 2.5
      + sin(vSurface.z * 4.0 + uTime * 0.35));
    vec3 tint = mix(uColor, uAccent, smoothstep(-0.8, 0.8, vSurface.x - vSurface.y * 0.55));
    vec3 color = tint * (0.2 + diffuse * 0.43 + current * 0.12);
    color += mix(uAccent, uColor, facing) * fresnel * (0.82 + uEnergy * 0.34);
    color += mix(uColor, vec3(1.0), 0.3) * reflection * 0.7;
    color += uAccent * broadReflection * 0.23;
    // Iridescence animée pendant la parole et la connexion : la couleur bouge plus que la forme.
    float flowBand = 0.5 + 0.5 * sin(vSurface.y * 6.0 - uTime * 2.2 + vSurface.x * 2.0);
    vec3 iridescence = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + vSurface.y * 5.0 + uTime * 1.4);
    color += mix(uColor, iridescence, 0.3) * flowBand * uShimmer * 0.3;
    float core = pow(facing, 9.0);
    color += uColor * core * (0.08 + uSpeech * 0.17);
    // A narrow search rim follows the deformed surface rather than a screen-space circle.
    float searchRim = 1.0 - smoothstep(0.025, 0.19, facing);
    float searchGlow = 1.0 - smoothstep(0.04, 0.36, facing);
    vec3 searchRed = vec3(1.0, 0.025, 0.055);
    color = mix(color, searchRed, searchRim * uWebSearch * 0.96);
    color += searchRed * searchGlow * uWebSearch * 0.16;
    gl_FragColor = vec4(color, 0.88 + fresnel * 0.12);
    #include <colorspace_fragment>
  }
`;

export const haloVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const haloFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uEnergy;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float distance = length(p);
    float band = exp(-pow((distance - 0.5) * 3.3, 2.0));
    float fade = 1.0 - smoothstep(0.7, 1.0, distance);
    vec3 color = mix(uColor, uAccent, smoothstep(-0.8, 0.8, p.x + p.y * 0.5));
    float alpha = band * fade * (0.22 + uEnergy * 0.16);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export const cardFragmentShader = /* glsl */ `
  uniform vec2 uSize;
  uniform vec2 uPlaneSize;
  uniform vec2 uLight;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uTint;
  uniform float uBirth;
  uniform float uVoice;
  uniform float uMotion;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uPlaneSize;
    // Naissance : une goutte quitte le bord tourné vers l’orbe, puis s’étire en carte.
    float grow = 1.0 - pow(1.0 - clamp(uBirth, 0.0, 1.0), 3.0);
    vec2 toward = normalize(uLight + vec2(0.001));
    float droplet = min(16.0, min(uSize.x, uSize.y) * 0.25);
    vec2 center = mix(toward * (uSize * 0.5 - droplet), vec2(0.0), grow);
    vec2 halfSize = mix(vec2(droplet), uSize * 0.5, grow);
    float radius = mix(droplet, uRadius, grow);
    vec2 local = p - center;
    vec2 q = abs(local) - halfSize + radius;
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    // Bord liquide : une ondulation lente de quelques pixels, plus marquée à la naissance.
    float around = atan(local.y, local.x);
    float wobble = sin(around * 3.0 + uTime * 0.55 + uSeed) * 0.9
      + sin(around * 5.0 - uTime * 0.8 + uSeed * 1.7) * 0.5;
    edge += wobble * uMotion * (0.6 + (1.0 - grow) * 1.6);
    float inside = 1.0 - smoothstep(-0.8, 0.8, edge);
    float angle = atan(p.y / uSize.y, p.x / uSize.x) + uTime * 0.09;
    vec3 rainbow = 0.48 + 0.4 * cos(angle + vec3(0.0, 2.094, 4.188));
    rainbow = mix(mix(rainbow, uColor, 0.12), uTint, 0.38);
    float towardOrb = 0.5 + 0.5 * dot(normalize(p + vec2(0.001)), toward);
    float voice = clamp(uVoice, 0.0, 1.0);
    float halo = exp(-max(edge, 0.0) * 0.075) * (0.24 + towardOrb * 0.17) * (1.0 + voice * 0.6);
    float rim = exp(-abs(edge) * 0.8);
    // Lumière de l’orbe qui entre dans le verre par le côté qui lui fait face.
    vec3 glass = vec3(0.004, 0.008, 0.011) + rainbow * exp(-abs(edge) * 0.16) * 0.027
      + uTint * pow(towardOrb, 3.0) * exp(-abs(edge) * 0.05) * 0.018;
    vec3 color = mix(rainbow, glass, inside);
    color += rainbow * rim * (0.38 + voice * 0.45);
    float alpha = mix(halo, 0.97, inside) * smoothstep(0.0, 0.18, uBirth);
    gl_FragColor = vec4(color, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

/** Thin microphone ribbon, with fixed endpoints and an audio-driven center. */
export const listeningLineFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uMotion;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float envelope = pow(max(0.0, sin(vUv.x * 3.14159265)), 1.8);
    float wave = sin(vUv.x * 23.0 - uTime * 16.0) * 0.65
      + sin(vUv.x * 37.0 + uTime * 11.0) * 0.35;
    float distanceToLine = abs(p.y - wave * envelope * uLevel * 12.0 * uMotion);
    float core = 1.0 - smoothstep(0.65, 1.5, distanceToLine);
    float glow = exp(-distanceToLine * 0.5) * uLevel * 0.35;
    float ends = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
    float alpha = (core * (0.16 + uLevel * 0.8) + glow) * ends;
    vec3 color = mix(vec3(0.16, 0.8, 0.72), vec3(0.65, 1.0, 0.94), uLevel);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;
