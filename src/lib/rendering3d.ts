import type { AnnotationLayer, AnnotationMark, VolumeData } from '../types/viewer'
import { fitCanvasToDevicePixelRatio } from './rendering'

// ─── WebGL Volume Ray Marching ───────────────────────────────────────────────
// Renders a solid 3D model from raw MRI voxel data using GPU ray marching.
// No point cloud, no dots – every pixel on screen is computed by marching a ray
// through the volume texture and accumulating opacity / colour.

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG_SRC = `
precision highp float;

varying vec2 v_uv;

uniform sampler2D u_volume;
uniform sampler2D u_mask;
uniform vec3 u_dims;
uniform int  u_tilesX;
uniform vec2 u_atlasSize;
uniform mat4 u_invModel;
uniform float u_zoom;
uniform vec2  u_pan;
uniform vec2  u_resolution;
uniform vec3  u_scale;
uniform float u_isoLevel;
uniform vec3 u_clip;

vec4 sampleMaskColor(vec3 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) return vec4(0.0);
  if (p.x > u_clip.x || p.y > u_clip.y || p.z > u_clip.z) return vec4(0.0);
  float slice = p.z * (u_dims.z - 1.0);
  float s0f = floor(slice + 0.5);
  float row0 = floor(s0f / float(u_tilesX));
  float col0 = s0f - row0 * float(u_tilesX);
  vec2 tileOrigin0 = vec2(col0 * u_dims.x, row0 * u_dims.y);
  vec2 uv0 = (tileOrigin0 + vec2(p.x * (u_dims.x - 1.0) + 0.5, p.y * (u_dims.y - 1.0) + 0.5)) / u_atlasSize;
  return texture2D(u_mask, uv0);
}

float sampleVolume(vec3 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) return 0.0;
  if (p.x > u_clip.x || p.y > u_clip.y || p.z > u_clip.z) return 0.0;

  float slice = p.z * (u_dims.z - 1.0);
  float s0f = floor(slice);
  float s1f = s0f + 1.0;
  float frac = slice - s0f;

  float row0 = floor(s0f / float(u_tilesX));
  float col0 = s0f - row0 * float(u_tilesX);
  vec2 tileOrigin0 = vec2(col0 * u_dims.x, row0 * u_dims.y);
  vec2 uv0 = (tileOrigin0 + vec2(p.x * (u_dims.x - 1.0) + 0.5, p.y * (u_dims.y - 1.0) + 0.5)) / u_atlasSize;
  float v0 = texture2D(u_volume, uv0).r;

  if (s1f >= u_dims.z) return v0;

  float row1 = floor(s1f / float(u_tilesX));
  float col1 = s1f - row1 * float(u_tilesX);
  vec2 tileOrigin1 = vec2(col1 * u_dims.x, row1 * u_dims.y);
  vec2 uv1 = (tileOrigin1 + vec2(p.x * (u_dims.x - 1.0) + 0.5, p.y * (u_dims.y - 1.0) + 0.5)) / u_atlasSize;
  float v1 = texture2D(u_volume, uv1).r;

  return mix(v0, v1, frac);
}

vec2 intersectBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 tmin = (bmin - ro) / rd;
  vec3 tmax = (bmax - ro) / rd;
  vec3 t1 = min(tmin, tmax);
  vec3 t2 = max(tmin, tmax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar  = min(min(t2.x, t2.y), t2.z);
  return vec2(tNear, tFar);
}

vec3 calcNormal(vec3 p) {
  float e = 1.5 / max(u_dims.x, max(u_dims.y, u_dims.z));
  float dx = sampleVolume(p + vec3(e,0,0)) - sampleVolume(p - vec3(e,0,0));
  float dy = sampleVolume(p + vec3(0,e,0)) - sampleVolume(p - vec3(0,e,0));
  float dz = sampleVolume(p + vec3(0,0,e)) - sampleVolume(p - vec3(0,0,e));
  vec3 n = vec3(dx / u_scale.x, dy / u_scale.y, dz / u_scale.z);
  float len = length(n);
  return len > 0.001 ? n / len : vec3(0.0, 1.0, 0.0);
}

float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - ab * t);
}

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  float aspect = u_resolution.x / u_resolution.y;
  uv.x *= aspect;

  // Split zoom: FOV narrows via sqrt, camera approaches via sqrt
  // so total magnification = zoom, but camera enters volume at high zoom
  float fovZ = sqrt(max(u_zoom, 1.0));
  float camDist = 2.2 / fovZ;

  uv = uv / fovZ - u_pan / u_resolution * 2.0;

  vec3 ro = vec3(0.0, 0.0, camDist);
  vec3 rd = normalize(vec3(uv, -1.8));

  ro = (u_invModel * vec4(ro, 1.0)).xyz + 0.5;
  rd = normalize((u_invModel * vec4(rd, 0.0)).xyz);

  vec3 boxMin = 0.5 - u_scale * 0.5;
  vec3 boxMax = 0.5 + u_scale * 0.5;
  vec2 tHit = intersectBox(ro, rd, boxMin, boxMax);

  vec3 bg = mix(vec3(0.07, 0.07, 0.08), vec3(0.11, 0.11, 0.12), v_uv.y);

  if (tHit.x > tHit.y) {
    gl_FragColor = vec4(bg, 1.0);
    return;
  }

  // Camera may be inside the volume — start from 0 in that case
  tHit.x = max(tHit.x, 0.0);

  float totalDist = tHit.y - tHit.x;
  float dt = totalDist / 256.0;
  vec4 acc = vec4(0.0);

  vec3 L1 = normalize(vec3(0.4, 0.7, 0.6));
  vec3 L2 = normalize(vec3(-0.3, -0.2, -0.8));

  float lo = u_isoLevel;
  float loHalf = lo * 0.5;

  // Transition: 0 = outside (solid Phong surface), 1 = inside (raw grayscale)
  float inMix = smoothstep(4.0, 25.0, u_zoom);
  // Reduce opacity with zoom so deeper tissue layers are visible
  float opScale = 1.0 / max(sqrt(u_zoom * 0.5), 1.0);

  for (int i = 0; i < 256; i++) {
    float t = tHit.x + float(i) * dt;
    if (t > tHit.y) break;

    vec3 p = ro + rd * t;
    vec3 sP = (p - boxMin) / u_scale;
    float val = sampleVolume(sP);

    if (val < loHalf) continue;

    // Transfer function — steep at surface, moderate inside
    float alpha = smoothstep(loHalf, lo * 1.5, val) * 0.09;
    alpha += smoothstep(lo * 1.5, 0.55, val) * 0.05;
    alpha += smoothstep(0.55, 0.9, val) * 0.12;
    alpha *= opScale;

    // Phong-shaded color (outside view)
    vec3 n = calcNormal(sP);
    float d1 = max(dot(n, L1), 0.0);
    float d2 = max(dot(n, L2), 0.0);
    vec3 hv = normalize(L1 - rd);
    float sc = pow(max(dot(n, hv), 0.0), 32.0) * 0.3;
    float lit = 0.3 + d1 * 0.55 + d2 * 0.2 + sc;
    float bri = 0.35 + 0.65 * smoothstep(loHalf, 0.85, val);
    vec3 colOut = vec3(bri * 0.92, bri * 0.89, bri * 0.84) * lit;

    // Raw grayscale MRI color (inside view — matches 2D slice detail)
    vec3 colIn = vec3(val);

    // Blend between outside and inside rendering
    vec3 col = mix(colOut, colIn, inMix);

    // Mask / annotation overlay
    vec4 maskInfo = sampleMaskColor(sP);
    if (maskInfo.a > 0.01) {
      col = mix(col, maskInfo.rgb, 0.55);
      alpha = max(alpha, 0.06);
    }

    acc.rgb += (1.0 - acc.a) * alpha * col;
    acc.a   += (1.0 - acc.a) * alpha;

    if (acc.a > 0.97) break;
  }

  vec3 finalColor = acc.rgb + (1.0 - acc.a) * bg;

  // ── Axis indicator widget (bottom-left corner) ──
  vec2 screenPt = v_uv * 2.0 - 1.0;
  screenPt.x *= aspect;
  vec2 axC = vec2(-aspect + 0.18, -0.82);
  float axLen = 0.1;
  float lineW = 0.005;

  // Volume axes projected to screen: model = transpose(invModel)
  // M column i (screen xy) = (u_invModel[0][i], u_invModel[1][i])
  vec2 rawX = vec2(u_invModel[0][0], u_invModel[1][0]);
  vec2 rawY = vec2(u_invModel[0][1], u_invModel[1][1]);
  vec2 rawZ = vec2(u_invModel[0][2], u_invModel[1][2]);
  // Use raw length to show foreshortening when axis points into screen
  vec2 aX = rawX;
  vec2 aY = rawY;
  vec2 aZ = rawZ;

  float dX = distToSegment(screenPt, axC, axC + aX * axLen);
  float dY = distToSegment(screenPt, axC, axC + aY * axLen);
  float dZ = distToSegment(screenPt, axC, axC + aZ * axLen);

  finalColor = mix(finalColor, vec3(1.0, 0.25, 0.25), smoothstep(lineW, lineW * 0.3, dX));
  finalColor = mix(finalColor, vec3(0.25, 1.0, 0.25), smoothstep(lineW, lineW * 0.3, dY));
  finalColor = mix(finalColor, vec3(0.4, 0.55, 1.0),  smoothstep(lineW, lineW * 0.3, dZ));

  // Axis labels (small dots at endpoints)
  float dotR = 0.012;
  float dotX = length(screenPt - (axC + aX * axLen));
  float dotY = length(screenPt - (axC + aY * axLen));
  float dotZ = length(screenPt - (axC + aZ * axLen));
  finalColor = mix(finalColor, vec3(1.0, 0.25, 0.25), smoothstep(dotR, dotR * 0.3, dotX));
  finalColor = mix(finalColor, vec3(0.25, 1.0, 0.25), smoothstep(dotR, dotR * 0.3, dotY));
  finalColor = mix(finalColor, vec3(0.4, 0.55, 1.0),  smoothstep(dotR, dotR * 0.3, dotZ));

  gl_FragColor = vec4(finalColor, 1.0);
}
`

// ─── State held per-canvas ───────────────────────────────────────────────────

interface GLState {
  gl: WebGLRenderingContext
  program: WebGLProgram
  volTexture: WebGLTexture
  maskTexture: WebGLTexture
  maskVersion: string
  tilesX: number
  atlasW: number
  atlasH: number
  dims: [number, number, number]
  dataRef: Uint8Array
  isoThreshold: number
  posBuf: WebGLBuffer
  locs: {
    a_pos: number
    u_volume: WebGLUniformLocation
    u_mask: WebGLUniformLocation
    u_dims: WebGLUniformLocation
    u_tilesX: WebGLUniformLocation
    u_atlasSize: WebGLUniformLocation
    u_invModel: WebGLUniformLocation
    u_zoom: WebGLUniformLocation
    u_pan: WebGLUniformLocation
    u_resolution: WebGLUniformLocation
    u_scale: WebGLUniformLocation
    u_isoLevel: WebGLUniformLocation
    u_clip: WebGLUniformLocation
  }
}

const stateMap = new WeakMap<HTMLCanvasElement, GLState>()

function compileShader(gl: WebGLRenderingContext, src: string, type: number) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(s))
  }
  return s
}

/** Compute an iso-surface threshold using Otsu's method on the volume data. */
function computeIsoThreshold(mri: Uint8Array, maxVal: number): number {
  if (maxVal === 0) return 0.12

  // Build histogram in atlas-normalised space (same values the shader sees)
  const hist = new Uint32Array(256)
  for (let i = 0; i < mri.length; i++) {
    hist[Math.min(255, Math.round(((mri[i] ?? 0) / maxVal) * 255))]!++
  }

  // Otsu's method – find the threshold that maximises inter-class variance
  const total = mri.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]!

  let sumB = 0
  let wB = 0
  let maxVar = 0
  let best = 0

  for (let i = 0; i < 256; i++) {
    wB += hist[i]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break

    sumB += i * hist[i]!
    const diff = sumB / wB - (sum - sumB) / wF
    const v = wB * wF * diff * diff

    if (v > maxVar) {
      maxVar = v
      best = i
    }
  }

  // Use 50 % of Otsu threshold so the surface captures the tissue
  // boundary rather than the midpoint between background and bright tissue.
  return Math.max(0.02, Math.min(0.4, (best * 0.5) / 255))
}

function buildAtlasTexture(
  gl: WebGLRenderingContext,
  volume: VolumeData,
): { texture: WebGLTexture; tilesX: number; atlasW: number; atlasH: number; isoThreshold: number } {
  const { width: W, height: H, depth: D, mri } = volume

  // Find max for normalisation
  let maxVal = 0
  for (let i = 0; i < mri.length; i++) {
    if (mri[i]! > maxVal) maxVal = mri[i]!
  }
  if (maxVal === 0) maxVal = 1

  // Layout slices in a 2-D atlas grid, capping both dimensions to the GPU limit
  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const tilesX = Math.min(D, Math.floor(maxTexSize / W))
  const tilesY = Math.ceil(D / tilesX)
  const atlasW = Math.min(tilesX * W, maxTexSize)
  const atlasH = Math.min(tilesY * H, maxTexSize)

  const pixels = new Uint8Array(atlasW * atlasH)

  for (let s = 0; s < D; s++) {
    const col = s % tilesX
    const row = Math.floor(s / tilesX)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = s * W * H + y * W + x
        const dstIdx = (row * H + y) * atlasW + (col * W + x)
        pixels[dstIdx] = Math.round(((mri[srcIdx] ?? 0) / maxVal) * 255)
      }
    }
  }

  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, atlasW, atlasH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels)

  const isoThreshold = computeIsoThreshold(mri, maxVal)
  return { texture: tex, tilesX, atlasW, atlasH, isoThreshold }
}

// ─── Mask atlas helpers ──────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ]
}

function pointInPolygon(px: number, py: number, contour: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const xi = contour[i]!.x, yi = contour[i]!.y
    const xj = contour[j]!.x, yj = contour[j]!.y
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function setMaskPixel(
  pixels: Uint8Array,
  view: 'axial' | 'coronal' | 'sagittal',
  slice: number,
  sx: number,
  sy: number,
  r: number,
  g: number,
  b: number,
  W: number,
  H: number,
  D: number,
  tilesX: number,
  atlasW: number,
) {
  let vx: number, vy: number, vz: number
  if (view === 'axial') {
    vx = sx; vy = sy; vz = slice
  } else if (view === 'coronal') {
    vx = sx; vy = slice; vz = sy
  } else {
    vx = slice; vy = sx; vz = sy
  }
  if (vx < 0 || vx >= W || vy < 0 || vy >= H || vz < 0 || vz >= D) return
  const col = vz % tilesX
  const row = Math.floor(vz / tilesX)
  const idx = ((row * H + vy) * atlasW + (col * W + vx)) * 4
  pixels[idx] = r
  pixels[idx + 1] = g
  pixels[idx + 2] = b
  pixels[idx + 3] = (r === 0 && g === 0 && b === 0) ? 0 : 255
}

function rasterizeMark(
  pixels: Uint8Array,
  mark: AnnotationMark,
  r: number,
  g: number,
  b: number,
  W: number,
  H: number,
  D: number,
  tilesX: number,
  atlasW: number,
) {
  const { view, slice } = mark

  if (mark.contour && mark.contour.length >= 3) {
    // Rasterize contour polygon
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const pt of mark.contour) {
      if (pt.x < minX) minX = pt.x
      if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.y > maxY) maxY = pt.y
    }
    const x0 = Math.max(0, Math.floor(minX))
    const x1 = Math.ceil(maxX)
    const y0 = Math.max(0, Math.floor(minY))
    const y1 = Math.ceil(maxY)
    for (let sy = y0; sy <= y1; sy++) {
      for (let sx = x0; sx <= x1; sx++) {
        if (pointInPolygon(sx, sy, mark.contour)) {
          setMaskPixel(pixels, view, slice, sx, sy, r, g, b, W, H, D, tilesX, atlasW)
        }
      }
    }
  } else {
    // Rasterize circle
    const rad = Math.ceil(mark.radius)
    const r2 = mark.radius * mark.radius
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > r2) continue
        setMaskPixel(pixels, view, slice, Math.round(mark.x) + dx, Math.round(mark.y) + dy, r, g, b, W, H, D, tilesX, atlasW)
      }
    }
  }
}

let cachedMaskPixels: Uint8Array | null = null
let cachedMaskSize = 0

function buildMaskAtlasPixels(
  volume: VolumeData,
  layers: AnnotationLayer[],
  showMask: boolean,
  tilesX: number,
  atlasW: number,
  atlasH: number,
): Uint8Array {
  const { width: W, height: H, depth: D, mask } = volume
  const totalSize = atlasW * atlasH * 4

  // Reuse allocation when possible to avoid repeated multi-MB allocations
  if (!cachedMaskPixels || cachedMaskSize !== totalSize) {
    cachedMaskPixels = new Uint8Array(totalSize)
    cachedMaskSize = totalSize
  } else {
    cachedMaskPixels.fill(0)
  }
  const pixels = cachedMaskPixels

  // Base tumor mask (pinkish like 2D overlay)
  if (showMask) {
    for (let s = 0; s < D; s++) {
      const col = s % tilesX
      const row = Math.floor(s / tilesX)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (mask[s * W * H + y * W + x]! > 0) {
            const idx = ((row * H + y) * atlasW + (col * W + x)) * 4
            pixels[idx] = 210
            pixels[idx + 1] = 52
            pixels[idx + 2] = 68
            pixels[idx + 3] = 255
          }
        }
      }
    }
  }

  // Annotation layers are replayed in draw order so later edits can paint back over erasures.
  for (const layer of layers) {
    if (!layer.visible) continue
    const [lr, lg, lb] = hexToRgb(layer.color)
    for (const mark of layer.annotations) {
      rasterizeMark(pixels, mark, mark.eraser ? 0 : lr, mark.eraser ? 0 : lg, mark.eraser ? 0 : lb, W, H, D, tilesX, atlasW)
    }
  }

  return pixels
}

function computeMaskVersion(layers: AnnotationLayer[], showMask: boolean): string {
  let v = showMask ? '1' : '0'
  for (const l of layers) {
    const eraserCount = l.annotations.filter(m => m.eraser).length
    v += `|${l.id}:${l.visible ? 1 : 0}:${l.annotations.length}:${eraserCount}`
  }
  return v
}

function initGL(canvas: HTMLCanvasElement, volume: VolumeData): GLState | null {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true })
  if (!gl) return null

  const vs = compileShader(gl, VERT_SRC, gl.VERTEX_SHADER)
  const fs = compileShader(gl, FRAG_SRC, gl.FRAGMENT_SHADER)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog))
    return null
  }

  const { texture, tilesX, atlasW, atlasH, isoThreshold } = buildAtlasTexture(gl, volume)

  // Start with a tiny 1×1 mask texture — resized to full atlas only when annotations exist
  const maskTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, maskTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))

  // Full-screen quad
  const posBuf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const locs = {
    a_pos: gl.getAttribLocation(prog, 'a_pos'),
    u_volume: gl.getUniformLocation(prog, 'u_volume')!,
    u_mask: gl.getUniformLocation(prog, 'u_mask')!,
    u_dims: gl.getUniformLocation(prog, 'u_dims')!,
    u_tilesX: gl.getUniformLocation(prog, 'u_tilesX')!,
    u_atlasSize: gl.getUniformLocation(prog, 'u_atlasSize')!,
    u_invModel: gl.getUniformLocation(prog, 'u_invModel')!,
    u_zoom: gl.getUniformLocation(prog, 'u_zoom')!,
    u_pan: gl.getUniformLocation(prog, 'u_pan')!,
    u_resolution: gl.getUniformLocation(prog, 'u_resolution')!,
    u_scale: gl.getUniformLocation(prog, 'u_scale')!,
    u_isoLevel: gl.getUniformLocation(prog, 'u_isoLevel')!,
    u_clip: gl.getUniformLocation(prog, 'u_clip')!,
  }

  const state: GLState = {
    gl, program: prog, volTexture: texture, maskTexture: maskTex, maskVersion: '',
    tilesX, atlasW, atlasH,
    dims: [volume.width, volume.height, volume.depth],
    dataRef: volume.mri,
    isoThreshold,
    posBuf, locs,
  }
  stateMap.set(canvas, state)
  return state
}

// Build a 4×4 rotation matrix from angles
function buildRotationMatrix(angleY: number, angleX: number): Float32Array {
  const cy = Math.cos(angleY), sy = Math.sin(angleY)
  const cx = Math.cos(angleX), sx = Math.sin(angleX)

  // Ry * Rx
  return new Float32Array([
     cy,     sy * sx,   sy * cx,  0,
     0,      cx,       -sx,       0,
    -sy,     cy * sx,   cy * cx,  0,
     0,      0,         0,        1,
  ])
}

function invertMatrix4(m: Float32Array): Float32Array {
  // For a rotation matrix the inverse is the transpose
  return new Float32Array([
    m[0]!, m[4]!, m[8]!,  m[12]!,
    m[1]!, m[5]!, m[9]!,  m[13]!,
    m[2]!, m[6]!, m[10]!, m[14]!,
    m[3]!, m[7]!, m[11]!, m[15]!,
  ])
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Render a seamless 3-D volume using WebGL ray marching. */
export function renderThreeDVolume(
  canvas: HTMLCanvasElement,
  volume: VolumeData,
  angleY: number,
  angleX: number,
  zoom: number,
  panX: number,
  panY: number,
  clipX: number = 1.0,
  clipY: number = 1.0,
  clipZ: number = 1.0,
  layers: AnnotationLayer[] = [],
  showMask: boolean = false,
): void {
  fitCanvasToDevicePixelRatio(canvas)

  let state = stateMap.get(canvas) ?? null

  // Re-init if volume data or dimensions changed
  if (!state || state.dims[0] !== volume.width || state.dims[1] !== volume.height || state.dims[2] !== volume.depth || state.dataRef !== volume.mri) {
    // Clean up old GL resources before rebuilding
    if (state) {
      state.gl.deleteTexture(state.volTexture)
      state.gl.deleteTexture(state.maskTexture)
      state.gl.deleteBuffer(state.posBuf)
      state.gl.deleteProgram(state.program)
      stateMap.delete(canvas)
    }
    state = initGL(canvas, volume)
  }

  if (!state) {
    // WebGL not available – fallback to simple message
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#18181b'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#aaa'
      ctx.font = '14px sans-serif'
      ctx.fillText('WebGL not available', 20, 30)
    }
    return
  }

  const { gl, program, volTexture, locs, posBuf, tilesX, atlasW, atlasH, dims, isoThreshold } = state

  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.07, 0.07, 0.08, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(program)

  // Bind volume texture
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, volTexture)
  gl.uniform1i(locs.u_volume, 0)

  // Update mask atlas if annotations changed
  const mv = computeMaskVersion(layers, showMask)
  if (mv !== state.maskVersion) {
    const hasVisibleAnnotations = layers.some((l) => l.visible && l.annotations.length > 0)
    if (!showMask && !hasVisibleAnnotations) {
      // Nothing to render — upload a tiny transparent texture instead of the full atlas
      gl.bindTexture(gl.TEXTURE_2D, state.maskTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    } else {
      const maskPixels = buildMaskAtlasPixels(volume, layers, showMask, tilesX, atlasW, atlasH)
      gl.bindTexture(gl.TEXTURE_2D, state.maskTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasW, atlasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskPixels)
    }
    state.maskVersion = mv
  }

  // Bind mask texture
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, state.maskTexture)
  gl.uniform1i(locs.u_mask, 1)

  gl.uniform3f(locs.u_dims, dims[0], dims[1], dims[2])
  gl.uniform1i(locs.u_tilesX, tilesX)
  gl.uniform2f(locs.u_atlasSize, atlasW, atlasH)
  gl.uniform1f(locs.u_zoom, zoom)
  gl.uniform2f(locs.u_pan, panX, panY)
  gl.uniform2f(locs.u_resolution, canvas.width, canvas.height)

  // Physical proportions: account for voxel count and spacing per axis
  const physW = volume.width * (volume.spacingX ?? 1)
  const physH = volume.height * (volume.spacingY ?? 1)
  const physD = volume.depth * (volume.spacingZ ?? 1)
  const maxPhys = Math.max(physW, physH, physD)
  gl.uniform3f(locs.u_scale, physW / maxPhys, physH / maxPhys, physD / maxPhys)
  gl.uniform1f(locs.u_isoLevel, isoThreshold)
  gl.uniform3f(locs.u_clip, clipX, clipY, clipZ)

  // Build inverse model (rotation) matrix
  const model = buildRotationMatrix(angleY, angleX)
  const invModel = invertMatrix4(model)
  gl.uniformMatrix4fv(locs.u_invModel, false, invModel)

  // Draw full-screen quad
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  gl.enableVertexAttribArray(locs.a_pos)
  gl.vertexAttribPointer(locs.a_pos, 2, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/** Destroy WebGL resources for a canvas. */
export function destroyThreeDVolume(canvas: HTMLCanvasElement): void {
  const state = stateMap.get(canvas)
  if (!state) return
  const { gl, program, volTexture, maskTexture, posBuf } = state
  gl.deleteTexture(volTexture)
  gl.deleteTexture(maskTexture)
  gl.deleteBuffer(posBuf)
  gl.deleteProgram(program)
  stateMap.delete(canvas)
}
