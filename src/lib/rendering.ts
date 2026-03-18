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
  highlightLayerId?: string,
): RenderTransform => {
  fitCanvasToDevicePixelRatio(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { drawX: 0, drawY: 0, drawW: 0, drawH: 0 }

  const { width: sourceWidth, height: sourceHeight } = getSliceSize(view, volume)
  const spacingX = volume.spacingX ?? 1
  const spacingY = volume.spacingY ?? 1
  const spacingZ = volume.spacingZ ?? 1

  const displaySourceWidth =
    view === 'sagittal' ? sourceWidth * spacingY : sourceWidth * spacingX
  const displaySourceHeight =
    view === 'axial' ? sourceHeight * spacingY : sourceHeight * spacingZ

  const baseTransform = getRenderTransform(displaySourceWidth, displaySourceHeight, canvas.width, canvas.height, settings)
  const rotatedTransform = getRenderTransform(displaySourceHeight, displaySourceWidth, canvas.width, canvas.height, settings)
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
        const radius = Math.max(mark.radius * radiusScale, 1)
        ctx.moveTo(cx + radius, cy)
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      }
      ctx.fill()
      continue
    }

    const isHighlighted = layer.id === highlightLayerId
    for (const mark of marks) {
      // Helper to map a slice-space point to canvas coordinates.
      const toCanvasX = (px: number) =>
        useRotated
          ? transform.drawX + ((sourceHeight - px) / sourceHeight) * transform.drawW
          : transform.drawX + (px / sourceWidth) * transform.drawW
      const toCanvasY = (py: number) =>
        useRotated
          ? transform.drawY + (py / sourceWidth) * transform.drawH
          : transform.drawY + (py / sourceHeight) * transform.drawH

      // If a contour polygon is available, draw it; otherwise fall back to a circle.
      if (mark.contour && mark.contour.length > 1) {
        const buildPath = () => {
          ctx.beginPath()
          const first = mark.contour![0]!
          // For rotated view the x/y swap must mirror what circle rendering does:
          // circle cx uses mark.y, cy uses mark.x — contour coords follow the same space.
          ctx.moveTo(
            useRotated ? toCanvasX(first.y) : toCanvasX(first.x),
            useRotated ? toCanvasY(first.x) : toCanvasY(first.y),
          )
          for (let i = 1; i < mark.contour!.length; i++) {
            const pt = mark.contour![i]!
            ctx.lineTo(
              useRotated ? toCanvasX(pt.y) : toCanvasX(pt.x),
              useRotated ? toCanvasY(pt.x) : toCanvasY(pt.y),
            )
          }
          ctx.closePath()
        }

        if (isHighlighted) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
          ctx.lineWidth = 5
          buildPath()
          ctx.stroke()
        }

        ctx.fillStyle = isHighlighted ? `${layer.color}55` : `${layer.color}33`
        ctx.strokeStyle = layer.color
        ctx.lineWidth = isHighlighted ? 2.5 : 1.5
        buildPath()
        ctx.fill()
        ctx.stroke()
      } else {
        // Fallback: plain circle (manual brush marks added to AI layers during editing).
        const cx = useRotated
          ? transform.drawX + ((sourceHeight - mark.y - 1) / sourceHeight) * transform.drawW
          : transform.drawX + (mark.x / sourceWidth) * transform.drawW
        const cy = useRotated
          ? transform.drawY + (mark.x / sourceWidth) * transform.drawH
          : transform.drawY + (mark.y / sourceHeight) * transform.drawH
        const radius = mark.radius * radiusScale

        if (isHighlighted) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
          ctx.lineWidth = 5
          ctx.beginPath()
          ctx.arc(cx, cy, Math.max(radius, 3), 0, Math.PI * 2)
          ctx.stroke()
        }

        ctx.fillStyle = isHighlighted ? `${layer.color}55` : `${layer.color}33`
        ctx.strokeStyle = layer.color
        ctx.lineWidth = isHighlighted ? 2.5 : 1.5
        ctx.beginPath()
        ctx.arc(cx, cy, Math.max(radius, 3), 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
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
      x: clamp(localY, 0, transform.sourceWidth - 1),
      y: clamp(transform.sourceHeight - localX - 1, 0, transform.sourceHeight - 1),
    }
  }

  const localX = ((x - transform.drawX) / transform.drawW) * sourceWidth
  const localY = ((y - transform.drawY) / transform.drawH) * sourceHeight
  return {
    x: clamp(localX, 0, sourceWidth - 1),
    y: clamp(localY, 0, sourceHeight - 1),
  }
}
