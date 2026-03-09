import type { VolumeData } from '../types/viewer'
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
uniform vec3 u_dims;
uniform int  u_tilesX;
uniform vec2 u_atlasSize;
uniform mat4 u_invModel;
uniform float u_zoom;
uniform vec2  u_pan;
uniform vec2  u_resolution;

float sampleVolume(vec3 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) return 0.0;

  float slice = p.z * (u_dims.z - 1.0);
  float s0f = floor(slice);
  float s1f = s0f + 1.0;
  float frac = slice - s0f;

  float row0 = floor(s0f / float(u_tilesX));
  float col0 = s0f - row0 * float(u_tilesX);
  vec2 tileOrigin0 = vec2(col0 * u_dims.x, row0 * u_dims.y);
  vec2 uv0 = (tileOrigin0 + vec2(p.x * u_dims.x, p.y * u_dims.y)) / u_atlasSize;
  float v0 = texture2D(u_volume, uv0).r;

  if (s1f >= u_dims.z) return v0;

  float row1 = floor(s1f / float(u_tilesX));
  float col1 = s1f - row1 * float(u_tilesX);
  vec2 tileOrigin1 = vec2(col1 * u_dims.x, row1 * u_dims.y);
  vec2 uv1 = (tileOrigin1 + vec2(p.x * u_dims.x, p.y * u_dims.y)) / u_atlasSize;
  float v1 = texture2D(u_volume, uv1).r;

  return mix(v0, v1, frac);
}

vec2 intersectBox(vec3 ro, vec3 rd) {
  vec3 tmin = (vec3(0.0) - ro) / rd;
  vec3 tmax = (vec3(1.0) - ro) / rd;
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
  vec3 n = vec3(dx, dy, dz);
  float len = length(n);
  return len > 0.001 ? n / len : vec3(0.0, 1.0, 0.0);
}

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  float aspect = u_resolution.x / u_resolution.y;
  uv.x *= aspect;

  uv = uv / u_zoom - u_pan / u_resolution * 2.0;

  vec3 ro = vec3(0.0, 0.0, 2.2);
  vec3 rd = normalize(vec3(uv, -1.8));

  ro = (u_invModel * vec4(ro, 1.0)).xyz + 0.5;
  rd = normalize((u_invModel * vec4(rd, 0.0)).xyz);

  vec2 tHit = intersectBox(ro, rd);
  if (tHit.x > tHit.y) {
    gl_FragColor = vec4(0.07, 0.07, 0.08, 1.0);
    return;
  }

  tHit.x = max(tHit.x, 0.0);

  // Use constant loop bound for WebGL 1.0 compatibility
  float totalDist = tHit.y - tHit.x;
  float stepSize = totalDist / 256.0;
  vec4 accum = vec4(0.0);
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.6));
  vec3 lightDir2 = normalize(vec3(-0.3, -0.2, -0.8));

  for (int i = 0; i < 256; i++) {
    float t = tHit.x + float(i) * stepSize;
    if (t > tHit.y) break;

    vec3 p = ro + rd * t;
    float val = sampleVolume(p);

    if (val < 0.04) continue;

    // Transfer function: map MRI intensity to opacity and colour
    float opacity = smoothstep(0.04, 0.25, val) * 0.12;

    // Boost opacity for brighter structures (bone, white matter)
    opacity += smoothstep(0.5, 0.9, val) * 0.15;

    // Phong shading with two lights
    vec3 n = calcNormal(p);
    float diffuse1 = max(dot(n, lightDir), 0.0) * 0.7; // Increased diffuse lighting
    float diffuse2 = max(dot(n, lightDir2), 0.0) * 0.5; // Increased secondary light contribution
    float ambient = 0.5; // Increased ambient light for better visibility
    float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 16.0) * 0.2;
    float lighting = ambient + diffuse1 + diffuse2 + spec;

    // Warm-tinted grayscale for a more natural look
    vec3 color = vec3(val * lighting * 1.0, val * lighting * 0.97, val * lighting * 0.93);

    accum.rgb += (1.0 - accum.a) * opacity * color;
    accum.a   += (1.0 - accum.a) * opacity;

    if (accum.a > 0.97) break;
  }

  vec3 bg = mix(vec3(0.07, 0.07, 0.08), vec3(0.11, 0.11, 0.12), v_uv.y);
  vec3 finalColor = accum.rgb + (1.0 - accum.a) * bg;

  gl_FragColor = vec4(finalColor, 1.0);
}
`

// ─── State held per-canvas ───────────────────────────────────────────────────

interface GLState {
  gl: WebGLRenderingContext
  program: WebGLProgram
  volTexture: WebGLTexture
  tilesX: number
  atlasW: number
  atlasH: number
  dims: [number, number, number]
  posBuf: WebGLBuffer
  locs: {
    a_pos: number
    u_volume: WebGLUniformLocation
    u_dims: WebGLUniformLocation
    u_tilesX: WebGLUniformLocation
    u_atlasSize: WebGLUniformLocation
    u_invModel: WebGLUniformLocation
    u_zoom: WebGLUniformLocation
    u_pan: WebGLUniformLocation
    u_resolution: WebGLUniformLocation
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

function buildAtlasTexture(
  gl: WebGLRenderingContext,
  volume: VolumeData,
): { texture: WebGLTexture; tilesX: number; atlasW: number; atlasH: number } {
  const { width: W, height: H, depth: D, mri } = volume

  // Find max for normalisation
  let maxVal = 0
  for (let i = 0; i < mri.length; i++) {
    if (mri[i]! > maxVal) maxVal = mri[i]!
  }
  if (maxVal === 0) maxVal = 1

  // Layout slices in a 2-D atlas grid
  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const tilesX = Math.min(D, Math.floor(maxTexSize / W))
  const tilesY = Math.ceil(D / tilesX)
  const atlasW = tilesX * W
  const atlasH = tilesY * H

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

  return { texture: tex, tilesX, atlasW, atlasH }
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

  const { texture, tilesX, atlasW, atlasH } = buildAtlasTexture(gl, volume)

  // Full-screen quad
  const posBuf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const locs = {
    a_pos: gl.getAttribLocation(prog, 'a_pos'),
    u_volume: gl.getUniformLocation(prog, 'u_volume')!,
    u_dims: gl.getUniformLocation(prog, 'u_dims')!,
    u_tilesX: gl.getUniformLocation(prog, 'u_tilesX')!,
    u_atlasSize: gl.getUniformLocation(prog, 'u_atlasSize')!,
    u_invModel: gl.getUniformLocation(prog, 'u_invModel')!,
    u_zoom: gl.getUniformLocation(prog, 'u_zoom')!,
    u_pan: gl.getUniformLocation(prog, 'u_pan')!,
    u_resolution: gl.getUniformLocation(prog, 'u_resolution')!,
  }

  const state: GLState = {
    gl, program: prog, volTexture: texture, tilesX, atlasW, atlasH,
    dims: [volume.width, volume.height, volume.depth],
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
): void {
  fitCanvasToDevicePixelRatio(canvas)

  let state = stateMap.get(canvas) ?? null

  // Re-init if volume dimensions changed or first call
  if (!state || state.dims[0] !== volume.width || state.dims[1] !== volume.height || state.dims[2] !== volume.depth) {
    // Destroy old context by getting a fresh one
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

  const { gl, program, volTexture, locs, posBuf, tilesX, atlasW, atlasH, dims } = state

  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.07, 0.07, 0.08, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)

  gl.useProgram(program)

  // Bind volume texture
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, volTexture)
  gl.uniform1i(locs.u_volume, 0)

  gl.uniform3f(locs.u_dims, dims[0], dims[1], dims[2])
  gl.uniform1i(locs.u_tilesX, tilesX)
  gl.uniform2f(locs.u_atlasSize, atlasW, atlasH)
  gl.uniform1f(locs.u_zoom, zoom)
  gl.uniform2f(locs.u_pan, panX, panY)
  gl.uniform2f(locs.u_resolution, canvas.width, canvas.height)

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
  const { gl, program, volTexture, posBuf } = state
  gl.deleteTexture(volTexture)
  gl.deleteBuffer(posBuf)
  gl.deleteProgram(program)
  stateMap.delete(canvas)
}

