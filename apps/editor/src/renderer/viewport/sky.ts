/**
 * The sky: a gradient from the horizon up and down, the sun's disc and glow (where the scene's Sun shines from),
 * drifting clouds lit from the sun's side, and stars where it's dark. One material, used by the game, the editor
 * and the Sky workspace's preview.
 */
import { skyOf, type SkySettings } from '@cocoaworlds/core';
import * as THREE from 'three';

/** The clouds' clock (seconds). */
const SKY_TIME = { value: 0 };

/** Where the sun shines from when the scene has no Sun (it then has no disc). */
export const DEFAULT_SUN_DIR = new THREE.Vector3(0.35, 0.6, 0.45).normalize();

export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      haze: { value: 0.4 },
      sunDir: { value: DEFAULT_SUN_DIR.clone() },
      sunColour: { value: new THREE.Color(1, 1, 1) },
      sunSize: { value: 5 },
      sunGlow: { value: 0.5 },
      clouds: { value: 0 },
      cloudSoft: { value: 0.5 },
      cloudSize: { value: 1 },
      cloudSpeed: { value: 0.5 },
      cloudColour: { value: new THREE.Color() },
      cloudShade: { value: new THREE.Color() },
      stars: { value: 0 },
      mtn: { value: 0 },
      mtnHeight: { value: 8 },
      mtnRugged: { value: 0.6 },
      mtnSnow: { value: 0.5 },
      mtnRock: { value: new THREE.Color() },
      mtnSnowCol: { value: new THREE.Color() },
      mtnSeed: { value: 1 },
      mtnLayers: { value: 3 },
      mtnDetail: { value: 5 },
      mtnSmooth: { value: 1 },
      vFog: { value: 0 },
      vFogHeight: { value: 1.5 },
      vFogCol: { value: new THREE.Color() },
      forest: { value: 0 },
      forestLine: { value: 0.5 },
      forestCol: { value: new THREE.Color() },
      treeSize: { value: 1 },
      forestType: { value: 0 },
      forestBand: { value: 0 },
      sea: { value: 0 },
      seaCol: { value: new THREE.Color() },
      seaWaves: { value: 1 },
      seaChop: { value: 0.5 },
      seaReflect: { value: 0.8 },
      time: SKY_TIME,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane: always behind everything
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
      uniform float haze;
      uniform vec3 sunDir; uniform vec3 sunColour; uniform float sunSize; uniform float sunGlow;
      uniform float clouds; uniform float cloudSoft; uniform float cloudSize; uniform float cloudSpeed;
      uniform vec3 cloudColour; uniform vec3 cloudShade;
      uniform float stars; uniform float time;
      uniform float mtn; uniform float mtnHeight; uniform float mtnRugged; uniform float mtnSnow;
      uniform vec3 mtnRock; uniform vec3 mtnSnowCol;
      uniform float mtnSeed; uniform float mtnLayers; uniform float mtnDetail; uniform float mtnSmooth;
      uniform float vFog; uniform float vFogHeight; uniform vec3 vFogCol;
      uniform float forest; uniform float forestLine; uniform vec3 forestCol; uniform float treeSize; uniform float forestBand; uniform float forestType;
      uniform float sea; uniform vec3 seaCol; uniform float seaWaves; uniform float seaChop; uniform float seaReflect;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
        return v;
      }
      float vnoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
          mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y),
          u.z);
      }
      // A range's ridge line: ridged fractal noise round the horizon circle (so it wraps seamlessly), 0…~1.
      float ridgeLine(vec2 circ, float freq, float seed, int oct) {
        float v = 0.0, a = 0.5;
        vec3 p = vec3(circ * freq, seed);
        for (int i = 0; i < 7; i++) {
          if (i >= oct) break;
          float n = vnoise(p);
          float r = 1.0 - abs(n * 2.0 - 1.0);
          v += a * mix(n, r * r, mtnRugged);
          p = p * 2.07 + vec3(5.1, 1.7, 3.3);
          a *= 0.5;
        }
        return v;
      }
      // Rock texture (gullies and crags), its octaves faded out where they'd be finer than a pixel (when smooth).
      float rockTex(vec3 p, float px) {
        float v = 0.0, a = 0.5, m = 1.0, tot = 0.0;
        for (int i = 0; i < 8; i++) {
          if (float(i) >= mtnDetail) break;
          float w = mtnSmooth > 0.5 ? 1.0 - smoothstep(0.2, 0.6, px * m) : 1.0;
          float r = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
          v += a * w * r * r + a * (1.0 - w) * 0.33; // a faded octave becomes its average
          tot += a;
          p = p * 2.03 + vec3(7.0, 3.0, 1.3);
          a *= 0.5; m *= 2.03;
        }
        return v / max(tot, 1e-4);
      }
      // Tree tops along the horizon, w wide (angle): conifers (spikes), broadleaf (round crowns) or mixed.
      // Returns (height in tree heights, a per-tree random, 1 if round). Finer than a pixel: they melt into their average.
      vec3 treeRow(float az, float w, float seed, float pix) {
        w = 6.2831853 / max(1.0, floor(6.2831853 / w)); // a whole number of trees round the circle: no seam
        float cell = az / w;
        float id = floor(cell);
        float r = hash(vec2(id, seed));
        float r2 = hash(vec2(id + 0.37, seed + 1.9));
        float round_ = forestType > 1.5 ? step(0.5, r2) : step(0.5, forestType);
        float x = fract(cell) - 0.5 + (r - 0.5) * mix(0.3, 0.12, round_);
        float cone = max(0.0, 1.0 - abs(x) * 2.3) * (0.6 + 0.6 * r);
        float crown = sqrt(max(0.0, 1.0 - x * x * 3.6)) * (0.7 + 0.4 * r);
        float tree = mix(cone, crown, round_);
        float fade = smoothstep(pix, pix * 3.0, w);
        return vec3(mix(0.45, tree, fade), r, round_);
      }
      // Where forest grows on a range: below the tree line (in patches), on the gentler faces.
      float forestMask(float rel, float slope, vec2 circ, float freq, float seed) {
        if (forest <= 0.0) return 0.0;
        float patches = vnoise(vec3(circ * freq * 3.0, seed + 40.0 + rel * 2.5));
        float line = forestLine + (patches - 0.5) * 0.35;
        float m = 1.0 - smoothstep(line - 0.06, line + 0.06, rel);
        m *= smoothstep(1.0 - forest, 1.0 - forest + 0.15, patches * 0.6 + 0.4 * forest);
        m = max(m, 1.0 - smoothstep(0.0, 0.2, rel)); // always wooded at the foot
        return m * (1.0 - smoothstep(1.0, 1.6, abs(slope)));
      }
      vec3 skyColour(vec3 d) {
        float y = d.y;
        // Gradient: haze lifts the horizon's colour higher up the sky.
        vec3 c = y >= 0.0 ? mix(horizon, top, pow(y, mix(0.9, 0.25, haze))) : mix(horizon, ground, pow(-y, 0.4));
        float s = dot(d, sunDir);
        float above = smoothstep(-0.02, 0.02, y);
        // Glow round the sun, wider low down where the light crosses more air.
        c += sunColour * sunGlow * (pow(max(s, 0.0), 6.0) * 0.25 + pow(max(s, 0.0), 48.0) * 0.6) * mix(1.0, 0.6, above * y);
        // The disc.
        if (sunSize > 0.0) {
          // Soft-edged: fades from 60% of its radius out to 140%.
          float a = degrees(acos(clamp(s, -1.0, 1.0)));
          float R = sunSize * 0.5;
          float disc = (1.0 - smoothstep(R * 0.6, R * 1.4, a)) * above;
          c = mix(c, sunColour * 1.4 + 0.25, disc);
        }
        // Stars where the sky is dark.
        if (stars > 0.0 && y > 0.0) {
          vec3 p = d * 260.0;
          float n = hash3(floor(p));
          float dark = 1.0 - smoothstep(0.05, 0.35, dot(c, vec3(0.299, 0.587, 0.114)));
          float tw = 0.7 + 0.3 * sin(time * 2.0 + n * 40.0);
          c += vec3(smoothstep(1.0 - 0.004 * stars, 1.0, n)) * dark * tw * smoothstep(0.0, 0.25, y) * 1.5;
        }
        // Clouds: on a high, flat layer, drifting, lit on the side towards the sun.
        if (clouds > 0.0 && y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) / (1.6 * cloudSize) + vec2(time * 0.012, time * 0.004) * cloudSpeed;
          float n = fbm(uv);
          float edge = 1.0 - clouds;
          float soft = 0.04 + 0.35 * cloudSoft;
          float density = smoothstep(edge - soft * 0.5, edge + soft * 0.5, n) * smoothstep(0.0, 0.18, y);
          float lit = clamp(0.55 + 0.45 * s + 0.3 * (n - edge), 0.0, 1.0);
          vec3 col = mix(cloudShade, cloudColour, lit);
          // A bright lining round clouds near the sun.
          col += sunColour * pow(max(s, 0.0), 10.0) * (1.0 - density) * 0.8;
          c = mix(c, col, density * 0.96);
        }
        // Mountains: up to three ranges, far to near, lit from the sun's side, snow-capped, hazed with distance,
        // with valley fog lying between them.
        float maxH = radians(mtnHeight) * 1.8;
        float el = asin(clamp(y, -1.0, 1.0));
        float foot = maxH * 0.25; // the ranges carry on below the horizon, fading into the ground
        if (mtn > 0.5 && el > -foot && el < maxH) {
          float az = atan(d.x, d.z);
          vec2 circ = vec2(cos(az), sin(az));
          float sunAz = atan(sunDir.x, sunDir.z);
          float side = sin(az - sunAz), facing = cos(az - sunAz);
          float pix = length(fwidth(d)); // a pixel's size, as an angle
          float day = smoothstep(-0.15, 0.2, sunDir.y);
          vec3 shadeLight = top * 0.45 + horizon * 0.15;
          vec3 sunLight = sunColour * day + shadeLight;
          int ridgeOct = mtnSmooth > 0.5 ? int(clamp(floor(log2(0.04 / max(pix, 1e-5))), 3.0, 7.0)) : 7;
          for (int L = 0; L < 3; L++) {
            if (float(L) < 3.0 - mtnLayers) continue;
            float fl = float(L);
            float freq = 3.0 + fl * 2.5, amp = 1.0 - fl * 0.22, seed = mtnSeed * 13.7 + fl * 17.0;
            float scale = maxH * amp;
            float h = ridgeLine(circ, freq, seed, ridgeOct) * scale;
            // Trees along the ridge where the forest reaches it.
            float th = radians(treeSize) * 0.06 * (0.5 + fl * 0.4);
            if (forest > 0.0) {
              float he = 0.02;
              float sl0 = (ridgeLine(vec2(cos(az + he), sin(az + he)), freq, seed, 3) - ridgeLine(vec2(cos(az - he), sin(az - he)), freq, seed, 3)) / (2.0 * he) / freq;
              h += treeRow(az, th * (0.5 + 0.3 * step(0.5, forestType)), seed, pix).x * th * forestMask(h / max(scale, 1e-4), sl0, circ, freq, seed);
            }
            float edge = mtnSmooth > 0.5 ? max(fwidth(el), 1e-5) : 1e-5;
            float cover = smoothstep(-edge, edge, h - el);
            if (cover > 0.0) {
              // Big faces: the slope of a smoothed ridge line, lit when it turns toward the sun.
              float e = 0.02;
              float hs0 = ridgeLine(vec2(cos(az - e), sin(az - e)), freq, seed, 3);
              float hs1 = ridgeLine(vec2(cos(az + e), sin(az + e)), freq, seed, 3);
              float slope = (hs1 - hs0) / (2.0 * e) / freq;
              // Gullies: rock texture in (around the horizon, down from the ridge), lit by its own slope.
              float R = freq * 6.0;
              float dep = (h - el) / max(scale, 1e-4);
              vec3 tp = vec3(circ * R, dep * R * 0.35 + seed);
              float tpx = pix * R * max(1.0, 0.35 / max(scale, 1e-4));
              float g0 = rockTex(tp, tpx);
              float g1 = rockTex(tp + vec3(-circ.y, circ.x, 0.0) * 0.08, tpx);
              float lit = 0.5 - 0.15 * facing;
              lit += clamp(slope * side * 1.6, -0.35, 0.35);
              lit += clamp((g1 - g0) * side * 5.0, -0.3, 0.3) + (g0 - 0.45) * 0.35 * mtnRugged;
              lit = clamp(lit, 0.0, 1.0);
              vec3 light = mix(shadeLight, sunLight, lit);
              vec3 col = mtnRock * light * 1.3;
              // Forest: dark canopy, bumpy, lit like the rock.
              float fm = forestMask(el / max(scale, 1e-4), slope, circ, freq, seed);
              if (fm > 0.0) {
                float canopy = vnoise(vec3(circ * R * 4.0, dep * R * 1.6 + seed + 9.0));
                float cw = mtnSmooth > 0.5 ? 1.0 - smoothstep(0.2, 0.6, tpx * 4.0) : 1.0;
                float fl2 = clamp(lit * 0.85 + (canopy - 0.5) * 0.5 * cw, 0.0, 1.0);
                col = mix(col, forestCol * mix(shadeLight, sunLight, fl2) * 1.2, fm);
              }
              // Snow: high up, on the gentler faces, its line broken by the crags.
              float rel = el / max(scale, 1e-4);
              float line = mix(0.95, 0.0, mtnSnow) + (0.45 - g0) * 0.4;
              float snow = smoothstep(line - 0.03, line + 0.03, rel) * (1.0 - smoothstep(0.7, 1.2, abs(slope)));
              col = mix(col, mtnSnowCol * mix(shadeLight * 1.3, sunLight, lit), snow);
              // Haze: thicker for farther ranges and near each range's foot.
              float hz = (2.0 - fl) * 0.3 + 0.05 + (1.0 - smoothstep(0.0, scale * 0.3, el)) * 0.3;
              col = mix(col, c, clamp(hz * (0.6 + haze * 0.6), 0.0, 1.0));
              col = mix(col, c, 1.0 - smoothstep(-foot, scale * 0.15, el)); // fade out at the foot
              c = mix(c, col, cover);
            }
            // Valley fog in front of this range (behind the nearer ones): a wispy band low on the horizon.
            if (vFog > 0.0) {
              float fh = radians(vFogHeight);
              float wisp = vnoise(vec3(circ * (24.0 + fl * 9.0), el / max(fh, 1e-4) * 1.5 + time * 0.02 + fl * 5.0));
              float band = 1.0 - smoothstep(0.0, fh, el + (wisp - 0.5) * fh * 0.8);
              vec3 fc = vFogCol * mix(vec3(0.75), sunLight, 0.45);
              c = mix(c, fc, clamp(band * vFog * 0.55 * smoothstep(-foot, -foot * 0.2, el), 0.0, 1.0));
            }
          }
        }
        // A forested shore: a low, dense band of trees along the horizon, in front of everything.
        if (forestBand > 0.0) {
          float elb = asin(clamp(y, -1.0, 1.0));
          float bh = radians(forestBand);
          if (elb > -bh * 0.3 && elb < bh * 2.5) {
            float az = atan(d.x, d.z);
            vec2 circ = vec2(cos(az), sin(az));
            float pix = length(fwidth(d));
            float base = bh * (0.55 + 0.6 * ridgeLine(circ, 6.0, mtnSeed * 3.1 + 77.0, 4));
            float th = radians(treeSize) * 0.6;
            float tw = forestType > 0.5 && forestType < 1.5 ? 0.75 : 0.45;
            vec3 t0 = treeRow(az, th * tw, mtnSeed + 5.0, pix);
            vec3 t1 = treeRow(az + th * 0.2, th * tw * 0.66, mtnSeed + 9.0, pix);
            float h = base + max(t0.x * th, t1.x * th * 0.6);
            vec3 tt = t0.x * th >= t1.x * th * 0.6 ? t0 : t1;
            float edge = mtnSmooth > 0.5 ? max(fwidth(elb), 1e-5) : 1e-5;
            float cover = smoothstep(-edge, edge, h - elb);
            if (cover > 0.0) {
              float sunAz = atan(sunDir.x, sunDir.z);
              float day = smoothstep(-0.15, 0.2, sunDir.y);
              vec3 shadeLight = top * 0.45 + horizon * 0.15;
              vec3 sunLight = sunColour * day + shadeLight;
              float canopy = vnoise(vec3(circ * 260.0, (h - elb) / max(th, 1e-4) * 2.0));
              float lit = clamp(0.4 - 0.15 * cos(az - sunAz) + (canopy - 0.5) * 0.45 + (elb - base) / max(th, 1e-4) * 0.15, 0.0, 1.0);
              // Each tree a little different; broadleaf a touch lighter and warmer than conifers.
              vec3 tint = forestCol * (0.85 + 0.3 * tt.y) * mix(vec3(1.0), vec3(1.15, 1.2, 0.95), tt.z);
              vec3 col = tint * mix(shadeLight, sunLight, lit) * 0.85;
              col = mix(col, c, (0.15 + haze * 0.25) * (1.0 - smoothstep(-bh * 0.3, bh, elb)) + 0.04);
              c = mix(c, col, cover);
            }
          }
        }
        return c;
      }
      // Waves: a few drifting noise layers; returns the height's slope (d/dx, d/dz) at p.
      vec2 waveSlope(vec2 p, float fade) {
        vec2 g = vec2(0.0);
        float a = 1.0, f = 1.0;
        for (int i = 0; i < 5; i++) {
          vec2 q = p * f + vec2(time * 0.35, time * 0.21) * (1.0 + float(i) * 0.3);
          float e = 0.05;
          vec3 b = vec3(q, float(i) * 3.1);
          g += a * vec2(vnoise(b + vec3(e, 0, 0)) - vnoise(b - vec3(e, 0, 0)), vnoise(b + vec3(0, e, 0)) - vnoise(b - vec3(0, e, 0))) / (2.0 * e);
          a *= 0.5 * fade; f *= 2.1;
        }
        return g;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c;
        if (sea > 0.5 && d.y < 0.0) {
          // The sea: a flat plane below, rippled by waves (calmer with distance, so it doesn't shimmer), reflecting the sky.
          float t = 1.0 / max(-d.y, 1e-3);
          vec2 p = d.xz * t * 6.0 / max(seaWaves, 0.05);
          float dist = smoothstep(4.0, 60.0, t);
          vec2 g = waveSlope(p, 1.0 - dist * 0.6) * seaChop * 0.25 * (1.0 - dist * 0.85);
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 r = reflect(d, n);
          r.y = abs(r.y);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-d, n), 0.0), 5.0);
          vec3 refl = skyColour(normalize(r));
          vec3 body = seaCol * (top * 0.35 + horizon * 0.25 + sunColour * max(sunDir.y, 0.0) * 0.35);
          c = mix(body, refl, clamp(fres * seaReflect + seaReflect * 0.25, 0.0, 1.0));
          // Glitter: the sun's sparkle on the wave faces.
          c += sunColour * pow(max(dot(normalize(r), sunDir), 0.0), 300.0) * 2.0 * seaReflect * step(0.0, sunDir.y);
          // Toward the horizon it melts into the sky's horizon colour (with the sun's glow there), so there's no line.
          float meet = pow(1.0 - smoothstep(0.0, 0.03 + haze * 0.12, -d.y), 1.5);
          if (meet > 0.002) c = mix(c, skyColour(normalize(vec3(d.x, 0.002, d.z))), meet);
        } else {
          c = skyColour(d);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/** Set a sky material from settings and the sun (toward it, world; null: no sun). */
export function applySky(m: THREE.ShaderMaterial, settings: SkySettings | undefined, sun: { dir: THREE.Vector3; colour: THREE.Color } | null): void {
  const s = skyOf(settings);
  const u = m.uniforms;
  u.top!.value.set(s.top);
  u.horizon!.value.set(s.horizon);
  u.ground!.value.set(s.ground);
  u.haze!.value = s.haze;
  u.sunDir!.value.copy(sun?.dir ?? DEFAULT_SUN_DIR);
  u.sunColour!.value.copy(sun?.colour ?? new THREE.Color(0, 0, 0));
  u.sunSize!.value = sun ? s.sunSize : 0;
  u.sunGlow!.value = s.sunGlow;
  u.clouds!.value = s.clouds;
  u.cloudSoft!.value = s.cloudSoftness;
  u.cloudSize!.value = s.cloudSize;
  u.cloudSpeed!.value = s.cloudSpeed;
  u.cloudColour!.value.set(s.cloudColour);
  u.cloudShade!.value.set(s.cloudShade);
  u.stars!.value = s.stars;
  u.mtn!.value = s.mountains ? 1 : 0;
  u.mtnHeight!.value = s.mtnHeight;
  u.mtnRugged!.value = s.mtnRugged;
  u.mtnSnow!.value = s.mtnSnow;
  u.mtnRock!.value.set(s.mtnRock);
  u.mtnSnowCol!.value.set(s.mtnSnowColour);
  u.mtnSeed!.value = s.mtnSeed;
  u.mtnLayers!.value = Math.round(Math.min(3, Math.max(1, s.mtnLayers)));
  u.mtnDetail!.value = Math.round(Math.min(8, Math.max(1, s.mtnDetail)));
  u.mtnSmooth!.value = s.mtnSmooth ? 1 : 0;
  u.vFog!.value = s.valleyFog;
  u.vFogHeight!.value = s.valleyFogHeight;
  u.vFogCol!.value.set(s.valleyFogColour);
  u.forest!.value = s.forest;
  u.forestLine!.value = s.forestLine;
  u.forestCol!.value.set(s.forestColour);
  u.treeSize!.value = s.treeSize;
  u.forestType!.value = s.forestType === 'broadleaf' ? 1 : s.forestType === 'mixed' ? 2 : 0;
  u.forestBand!.value = s.forestBand;
  u.sea!.value = s.sea ? 1 : 0;
  u.seaCol!.value.set(s.seaColour);
  u.seaWaves!.value = s.seaWaves;
  u.seaChop!.value = s.seaChop;
  u.seaReflect!.value = s.seaReflect;
}

/** A sky dome that follows the camera (so it never gets nearer). */
export function skyMesh(m: THREE.ShaderMaterial): THREE.Mesh {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.onBeforeRender = (_r, _s, cam) => {
    SKY_TIME.value = performance.now() / 1000;
    // (World position: a reflection probe's cameras sit inside a moved group.)
    cam.getWorldPosition(sky.position);
    sky.scale.setScalar(1000);
    sky.updateMatrixWorld();
  };
  return sky;
}

/** The sun's colour as the sky shows it: its light colour, brighter for a brighter sun (within reason). */
export function sunSkyColour(colour: string, intensity: number): THREE.Color {
  return new THREE.Color(colour).multiplyScalar(Math.min(1.2, 0.35 + intensity * 0.3));
}

/** Ambient light colours taken from a sky: from above (between its top and horizon) and below. */
export function skyAmbient(settings: SkySettings | undefined): { above: THREE.Color; below: THREE.Color; fog: THREE.Color } {
  const s = skyOf(settings);
  const above = new THREE.Color(s.top).lerp(new THREE.Color(s.horizon), 0.45);
  return { above, below: new THREE.Color(s.ground).lerp(above, 0.25), fog: new THREE.Color(s.horizon) };
}

/** The sky as an equirectangular environment texture (PNG, 2:1), for reflections and lighting elsewhere. */
export async function skyEnvPng(settings: SkySettings | undefined, sun: { dir: THREE.Vector3; colour: THREE.Color } | null, width = 2048): Promise<Uint8Array> {
  const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  const mat = skyMaterial();
  const cube = new THREE.WebGLCubeRenderTarget(width / 2, { type: THREE.HalfFloatType });
  const quad = new THREE.ShaderMaterial({
    uniforms: { env: { value: cube.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform samplerCube env; varying vec2 vUv;
      void main() {
        float lon = (vUv.x - 0.5) * 6.2831853, lat = (vUv.y - 0.5) * 3.1415927;
        gl_FragColor = vec4(textureCube(env, vec3(-sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat))).rgb, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  try {
    applySky(mat, settings, sun);
    const scene = new THREE.Scene();
    scene.add(skyMesh(mat));
    new THREE.CubeCamera(0.1, 5000, cube).update(r, scene);
    r.setSize(width, width / 2, false);
    const flat = new THREE.Scene();
    flat.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quad));
    r.render(flat, new THREE.Camera());
    const blob = await new Promise<Blob | null>((ok) => r.domElement.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('The sky could not be drawn.');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    mat.dispose();
    quad.dispose();
    cube.dispose();
    r.dispose();
  }
}

/** Skybox faces, as a viewer at the centre sees them (front: -Z; top/bottom seen while facing front). */
export const SKYBOX_FACES: { key: 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back'; dir: [number, number, number]; up: [number, number, number] }[] = [
  { key: 'right', dir: [1, 0, 0], up: [0, 1, 0] },
  { key: 'left', dir: [-1, 0, 0], up: [0, 1, 0] },
  { key: 'top', dir: [0, 1, 0], up: [0, 0, 1] },
  { key: 'bottom', dir: [0, -1, 0], up: [0, 0, -1] },
  { key: 'front', dir: [0, 0, -1], up: [0, 1, 0] },
  { key: 'back', dir: [0, 0, 1], up: [0, 1, 0] },
];

export type SkyBoxNaming = 'words' | 'axes' | 'unity';
export type SkyBoxLayout = 'files' | 'cross' | 'strip';
const FACE_NAMES: Record<SkyBoxNaming, Record<(typeof SKYBOX_FACES)[number]['key'], string>> = {
  words: { right: 'right', left: 'left', top: 'top', bottom: 'bottom', front: 'front', back: 'back' },
  axes: { right: 'px', left: 'nx', top: 'py', bottom: 'ny', front: 'nz', back: 'pz' },
  unity: { right: 'Right', left: 'Left', top: 'Up', bottom: 'Down', front: 'Front', back: 'Back' },
};
/** Where each face sits in a 4×3 horizontal cross (column, row). */
const CROSS: Record<string, [number, number]> = { top: [1, 0], left: [0, 1], front: [1, 1], right: [2, 1], back: [3, 1], bottom: [1, 2] };

const pngOf = async (c: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('The sky could not be drawn.');
  return new Uint8Array(await blob.arrayBuffer());
};

/** The sky cut into six square skybox faces: six PNGs, or one PNG laid out as a cross or a strip. */
export async function skyBoxPngs(
  settings: SkySettings | undefined,
  sun: { dir: THREE.Vector3; colour: THREE.Color } | null,
  opts: { size?: number; naming?: SkyBoxNaming; layout?: SkyBoxLayout } = {},
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const size = opts.size ?? 1024, naming = opts.naming ?? 'words', layout = opts.layout ?? 'files';
  const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  const mat = skyMaterial();
  const sheet = layout === 'files' ? null : document.createElement('canvas');
  if (sheet) {
    sheet.width = size * (layout === 'cross' ? 4 : 6);
    sheet.height = size * (layout === 'cross' ? 3 : 1);
  }
  try {
    applySky(mat, settings, sun);
    const scene = new THREE.Scene();
    scene.add(skyMesh(mat));
    r.setSize(size, size, false);
    const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 5000);
    const out: { name: string; bytes: Uint8Array }[] = [];
    for (const [i, f] of SKYBOX_FACES.entries()) {
      cam.up.set(...f.up);
      cam.lookAt(...f.dir);
      cam.updateMatrixWorld();
      r.render(scene, cam);
      if (!sheet) out.push({ name: `sky_${FACE_NAMES[naming][f.key]}.png`, bytes: await pngOf(r.domElement) });
      else {
        const [cx, cy] = layout === 'cross' ? CROSS[f.key]! : [i, 0];
        sheet.getContext('2d')!.drawImage(r.domElement, cx * size, cy * size);
      }
    }
    if (sheet) out.push({ name: `sky_${layout}.png`, bytes: await pngOf(sheet) });
    return out;
  } finally {
    mat.dispose();
    r.dispose();
  }
}
