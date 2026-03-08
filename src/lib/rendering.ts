import type { AnnotationLayer, RenderSettings, ViewType, VolumeData } from '../types/viewer'
import { getSliceSize, readVoxelByView } from './volume'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const fitCanvasToDevicePixelRatio = (canvas: HTMLCanvasElement): void => {
  const ratio = window.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight

  const nextWidth = Math.floor(cssWidth * ratio)
  const nextHeight = Math.floor(cssHeight * ratio)

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth
    canvas.height = nextHeight
  }
}

export interface RenderTransform {
  drawX: number
  drawY: number
  drawW: number
  drawH: number
  rotated?: boolean
  sourceWidth?: number
  sourceHeight?: number
}

export const getRenderTransform = (
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  settings: RenderSettings,
): RenderTransform => {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight) * settings.zoom
  const drawW = sourceWidth * scale
  const drawH = sourceHeight * scale

  return {
    drawX: (canvasWidth - drawW) * 0.5 + settings.panX,
    drawY: (canvasHeight - drawH) * 0.5 + settings.panY,
    drawW,
    drawH,
  }
}

const applyWindowLevel = (value: number, center: number, width: number): number => {
  const min = center - width * 0.5
  const max = center + width * 0.5
  const normalized = ((value - min) / (max - min)) * 255
  return clamp(normalized, 0, 255)
}

const getSliceFromLayer = (
  layer: AnnotationLayer,
  view: Exclude<ViewType, 'threeD'>,
  sliceIndex: number,
) => layer.annotations.filter((mark) => mark.view === view && mark.slice === sliceIndex)

export const renderSlice = (
  canvas: HTMLCanvasElement,
  view: Exclude<ViewType, 'threeD'>,
  sliceIndex: number,
  volume: VolumeData,
  settings: RenderSettings,
  layers: AnnotationLayer[],
  showMaskOverlay: boolean,
  rotateToFill = false,
): RenderTransform => {
  fitCanvasToDevicePixelRatio(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { drawX: 0, drawY: 0, drawW: 0, drawH: 0 }

  const { width: sourceWidth, height: sourceHeight } = getSliceSize(view, volume)
  const baseTransform = getRenderTransform(sourceWidth, sourceHeight, canvas.width, canvas.height, settings)
  const rotatedTransform = getRenderTransform(sourceHeight, sourceWidth, canvas.width, canvas.height, settings)
  const rotatedArea = rotatedTransform.drawW * rotatedTransform.drawH
  const normalArea = baseTransform.drawW * baseTransform.drawH
  const useRotated = rotateToFill && rotatedArea > normalArea * 1.04
  const transform = useRotated ? rotatedTransform : baseTransform
  const buffer = new ImageData(sourceWidth, sourceHeight)

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const { mri, mask } = readVoxelByView(view, x, y, sliceIndex, volume)
      let gray = applyWindowLevel(mri, settings.windowCenter, settings.windowWidth)
      gray = clamp((gray - 128) * settings.contrast + 128, 0, 255)
      if (gray < settings.threshold) gray = 0
      if (settings.inverted) gray = 255 - gray

      const pixel = (y * sourceWidth + x) * 4
      let r = gray
      let g = gray
      let b = gray

      if (showMaskOverlay && mask > 0) {
        r = gray * 0.25 + 210 * 0.75
        g = gray * 0.25 + 52 * 0.75
        b = gray * 0.25 + 68 * 0.75
      }

      buffer.data[pixel] = r
      buffer.data[pixel + 1] = g
      buffer.data[pixel + 2] = b
      buffer.data[pixel + 3] = 255
    }
  }

  const offscreen = document.createElement('canvas')
  offscreen.width = sourceWidth
  offscreen.height = sourceHeight
  const offscreenCtx = offscreen.getContext('2d')
  if (!offscreenCtx) return { ...transform, rotated: useRotated, sourceWidth, sourceHeight }

  offscreenCtx.putImageData(buffer, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const vignette = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  vignette.addColorStop(0, '#1c1d20')
  vignette.addColorStop(1, '#27272a')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (useRotated) {
    ctx.save()
    ctx.translate(transform.drawX + transform.drawW * 0.5, transform.drawY + transform.drawH * 0.5)
    ctx.rotate(Math.PI * 0.5)
    ctx.drawImage(offscreen, -transform.drawH * 0.5, -transform.drawW * 0.5, transform.drawH, transform.drawW)
    ctx.restore()
  } else {
    ctx.drawImage(offscreen, transform.drawX, transform.drawY, transform.drawW, transform.drawH)
  }

  for (const layer of layers.filter((entry) => entry.visible)) {
    const marks = getSliceFromLayer(layer, view, sliceIndex)
    if (!marks.length) continue

    const radiusScale = useRotated ? transform.drawW / sourceHeight : transform.drawW / sourceWidth

    if (layer.type === 'manual') {
      // Render a single filled path so brush strokes keep a uniform opacity without ring artifacts.
      ctx.fillStyle = `${layer.color}99`
      ctx.beginPath()
      for (const mark of marks) {
        const cx = useRotated
          ? transform.drawX + ((sourceHeight - mark.y - 1) / sourceHeight) * transform.drawW
          : transform.drawX + (mark.x / sourceWidth) * transform.drawW
        const cy = useRotated
          ? transform.drawY + (mark.x / sourceWidth) * transform.drawH
          : transform.drawY + (mark.y / sourceHeight) * transform.drawH
        const radius = Math.max(mark.radius * radiusScale, 2)
        ctx.moveTo(cx + radius, cy)
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      }
      ctx.fill()
      continue
    }

    ctx.strokeStyle = layer.color
    ctx.lineWidth = 2
    ctx.fillStyle = `${layer.color}33`
    for (const mark of marks) {
      const cx = useRotated
        ? transform.drawX + ((sourceHeight - mark.y - 1) / sourceHeight) * transform.drawW
        : transform.drawX + (mark.x / sourceWidth) * transform.drawW
      const cy = useRotated
        ? transform.drawY + (mark.x / sourceWidth) * transform.drawH
        : transform.drawY + (mark.y / sourceHeight) * transform.drawH
      const radius = mark.radius * radiusScale

      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(radius, 3), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  return { ...transform, rotated: useRotated, sourceWidth, sourceHeight }
}

export const screenToSlice = (
  x: number,
  y: number,
  transform: RenderTransform,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number } | null => {
  if (
    x < transform.drawX ||
    y < transform.drawY ||
    x > transform.drawX + transform.drawW ||
    y > transform.drawY + transform.drawH
  ) {
    return null
  }

  if (transform.rotated && transform.sourceWidth && transform.sourceHeight) {
    const localX = ((x - transform.drawX) / transform.drawW) * transform.sourceHeight
    const localY = ((y - transform.drawY) / transform.drawH) * transform.sourceWidth
    return {
      x: clamp(Math.round(localY), 0, transform.sourceWidth - 1),
      y: clamp(Math.round(transform.sourceHeight - localX - 1), 0, transform.sourceHeight - 1),
    }
  }

  const localX = ((x - transform.drawX) / transform.drawW) * sourceWidth
  const localY = ((y - transform.drawY) / transform.drawH) * sourceHeight
  return {
    x: clamp(Math.round(localX), 0, sourceWidth - 1),
    y: clamp(Math.round(localY), 0, sourceHeight - 1),
  }
}

const rotatePoint = (
  x: number,
  y: number,
  z: number,
  angleY: number,
  angleX: number,
): { x: number; y: number; z: number } => {
  const cosY = Math.cos(angleY)
  const sinY = Math.sin(angleY)
  const cosX = Math.cos(angleX)
  const sinX = Math.sin(angleX)

  const x1 = x * cosY - z * sinY
  const z1 = x * sinY + z * cosY
  const y1 = y * cosX - z1 * sinX
  const z2 = y * sinX + z1 * cosX

  return { x: x1, y: y1, z: z2 }
}

export const renderThreeD = (
  canvas: HTMLCanvasElement,
  points: Array<{ x: number; y: number; z: number }>,
  angle: number,
): void => {
  fitCanvasToDevicePixelRatio(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const bg = ctx.createRadialGradient(
    canvas.width * 0.4,
    canvas.height * 0.32,
    8,
    canvas.width * 0.5,
    canvas.height * 0.5,
    canvas.width * 0.75,
  )
  bg.addColorStop(0, '#3f3f46')
  bg.addColorStop(1, '#18181b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const centerX = canvas.width * 0.5
  const centerY = canvas.height * 0.53
  const scale = Math.min(canvas.width, canvas.height) * 0.58

  ctx.strokeStyle = 'rgba(161, 161, 170, 0.35)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, scale * (0.38 + i * 0.045), scale * (0.28 + i * 0.03), 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  for (const point of points) {
    const rotated = rotatePoint(point.x, point.y, point.z, angle, angle * 0.3)
    const perspective = 1.15 + rotated.z
    const x = centerX + (rotated.x * scale) / perspective
    const y = centerY + (rotated.y * scale) / perspective
    const radius = clamp(2.4 - rotated.z * 1.4, 0.8, 3.1)

    ctx.fillStyle = `rgba(248, 113, 113, ${clamp(0.2 + (rotated.z + 0.5) * 0.7, 0.18, 0.9)})`
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = 'rgba(250, 250, 250, 0.92)'
  ctx.font = `${Math.max(11, Math.round(canvas.width * 0.022))}px "Plus Jakarta Sans"`
  ctx.fillText('3D Tumor Rendering (Prototype)', 16, 26)
}
