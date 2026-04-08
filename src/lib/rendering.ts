import type { AnnotationLayer, RenderSettings, ViewType, VolumeData } from '../types/viewer'
import { getSliceSize } from './volume'

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
  flip180?: boolean
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

// ── Per-canvas cached resources ──

interface SliceCacheEntry {
  view: string
  sliceIndex: number
  windowCenter: number
  windowWidth: number
  contrast: number
  threshold: number
  inverted: boolean
  showMask: boolean
  sourceWidth: number
  sourceHeight: number
  imageData: ImageData
}

const sliceCache = new WeakMap<HTMLCanvasElement, SliceCacheEntry>()
const offscreenCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()
/** Get or create a reusable offscreen canvas. */
const getOffscreen = (key: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement => {
  let c = offscreenCache.get(key)
  if (!c) {
    c = document.createElement('canvas')
    offscreenCache.set(key, c)
  }
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return c
}

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
  const spacingX = volume.spacingX ?? 1
  const spacingY = volume.spacingY ?? 1
  const spacingZ = volume.spacingZ ?? 1

  const displaySourceWidth =
    view === 'sagittal' ? sourceWidth * spacingY : sourceWidth * spacingX
  const displaySourceHeight =
    view === 'axial' ? sourceHeight * spacingY : sourceHeight * spacingZ

  const flip180 = !!(volume.flipCorSag && view !== 'axial')

  const baseTransform = getRenderTransform(displaySourceWidth, displaySourceHeight, canvas.width, canvas.height, settings)
  const rotatedTransform = getRenderTransform(displaySourceHeight, displaySourceWidth, canvas.width, canvas.height, settings)
  const rotatedArea = rotatedTransform.drawW * rotatedTransform.drawH
  const normalArea = baseTransform.drawW * baseTransform.drawH
  const useRotated = rotateToFill && rotatedArea > normalArea * 1.04
  const transform = useRotated ? rotatedTransform : baseTransform

  // ── Cached base slice rendering ──
  const cached = sliceCache.get(canvas)
  const cacheHit =
    cached !== undefined &&
    cached.view === view &&
    cached.sliceIndex === sliceIndex &&
    cached.windowCenter === settings.windowCenter &&
    cached.windowWidth === settings.windowWidth &&
    cached.contrast === settings.contrast &&
    cached.threshold === settings.threshold &&
    cached.inverted === settings.inverted &&
    cached.showMask === showMaskOverlay &&
    cached.sourceWidth === sourceWidth &&
    cached.sourceHeight === sourceHeight

  let buffer: ImageData
  if (cacheHit) {
    buffer = cached.imageData
  } else {
    buffer = new ImageData(sourceWidth, sourceHeight)

    // Inline voxel index computation — avoids per-pixel function call + object allocation.
    const mri = volume.mri
    const mask = volume.mask
    const vw = volume.width
    const vh = volume.height
    let baseIdx: number
    let strideX: number
    let strideY: number

    if (view === 'axial') {
      baseIdx = sliceIndex * vw * vh
      strideX = 1
      strideY = vw
    } else if (view === 'coronal') {
      baseIdx = sliceIndex * vw
      strideX = 1
      strideY = vw * vh
    } else {
      // sagittal
      baseIdx = sliceIndex
      strideX = vw
      strideY = vw * vh
    }

    const wc = settings.windowCenter
    const ww = settings.windowWidth
    const ct = settings.contrast
    const th = settings.threshold
    const inv = settings.inverted
    const data = buffer.data

    for (let y = 0; y < sourceHeight; y += 1) {
      const rowIdx = baseIdx + y * strideY
      for (let x = 0; x < sourceWidth; x += 1) {
        const idx = rowIdx + x * strideX
        const mriVal = mri[idx] ?? 0
        const maskVal = mask[idx] ?? 0

        let gray = applyWindowLevel(mriVal, wc, ww)
        gray = clamp((gray - 128) * ct + 128, 0, 255)
        if (gray < th) gray = 0
        if (inv) gray = 255 - gray

        const pixel = (y * sourceWidth + x) * 4
        let r = gray
        let g = gray
        let b = gray

        if (showMaskOverlay && maskVal > 0) {
          r = gray * 0.25 + 210 * 0.75
          g = gray * 0.25 + 52 * 0.75
          b = gray * 0.25 + 68 * 0.75
        }

        data[pixel] = r
        data[pixel + 1] = g
        data[pixel + 2] = b
        data[pixel + 3] = 255
      }
    }

    sliceCache.set(canvas, {
      view,
      sliceIndex,
      windowCenter: wc,
      windowWidth: ww,
      contrast: ct,
      threshold: th,
      inverted: inv,
      showMask: showMaskOverlay,
      sourceWidth,
      sourceHeight,
      imageData: buffer,
    })
  }

  // ── Draw base image ──
  const offscreen = getOffscreen(canvas, sourceWidth, sourceHeight)
  const offscreenCtx = offscreen.getContext('2d')
  if (!offscreenCtx) return { ...transform, rotated: useRotated, flip180, sourceWidth, sourceHeight }

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
  } else if (flip180) {
    ctx.save()
    ctx.translate(transform.drawX + transform.drawW * 0.5, transform.drawY + transform.drawH * 0.5)
    ctx.rotate(Math.PI)
    ctx.drawImage(offscreen, -transform.drawW * 0.5, -transform.drawH * 0.5, transform.drawW, transform.drawH)
    ctx.restore()
  } else {
    ctx.drawImage(offscreen, transform.drawX, transform.drawY, transform.drawW, transform.drawH)
  }

  // ── Annotation layers ──

  // Helper: map slice-space mark to canvas coordinates
  const markToCx = (mark: { x: number; y: number }) => {
    if (useRotated) return transform.drawX + ((sourceHeight - mark.y - 1) / sourceHeight) * transform.drawW
    const nx = flip180 ? (sourceWidth - mark.x) : mark.x
    return transform.drawX + (nx / sourceWidth) * transform.drawW
  }
  const markToCy = (mark: { x: number; y: number }) => {
    if (useRotated) return transform.drawY + (mark.x / sourceWidth) * transform.drawH
    const ny = flip180 ? (sourceHeight - mark.y) : mark.y
    return transform.drawY + (ny / sourceHeight) * transform.drawH
  }
  const toCanvasX = (px: number) => {
    if (useRotated) return transform.drawX + ((sourceHeight - px) / sourceHeight) * transform.drawW
    const nx = flip180 ? (sourceWidth - px) : px
    return transform.drawX + (nx / sourceWidth) * transform.drawW
  }
  const toCanvasY = (py: number) => {
    if (useRotated) return transform.drawY + (py / sourceWidth) * transform.drawH
    const ny = flip180 ? (sourceHeight - py) : py
    return transform.drawY + (ny / sourceHeight) * transform.drawH
  }

  const drawContourMark = (
    target: CanvasRenderingContext2D,
    mark: AnnotationLayer['annotations'][number],
    layer: AnnotationLayer,
  ) => {
    if (!mark.contour || mark.contour.length <= 1) return

    target.beginPath()
    const first = mark.contour[0]!
    target.moveTo(
      useRotated ? toCanvasX(first.y) : toCanvasX(first.x),
      useRotated ? toCanvasY(first.x) : toCanvasY(first.y),
    )
    for (let i = 1; i < mark.contour.length; i++) {
      const pt = mark.contour[i]!
      target.lineTo(
        useRotated ? toCanvasX(pt.y) : toCanvasX(pt.x),
        useRotated ? toCanvasY(pt.x) : toCanvasY(pt.y),
      )
    }
    target.closePath()
    target.fillStyle = `${layer.color}cc`
    target.fill()
  }

  const drawStrokeRun = (
    target: CanvasRenderingContext2D,
    marks: AnnotationLayer['annotations'],
    layer: AnnotationLayer,
    radiusScale: number,
  ) => {
    if (!marks.length) return

    const avgRadius = marks.reduce((sum, mark) => sum + mark.radius, 0) / marks.length
    const lineWidth = Math.max(avgRadius * radiusScale * 2, 2)
    const gapThreshold = avgRadius * 4

    target.strokeStyle = `${layer.color}cc`
    target.lineWidth = lineWidth
    target.lineCap = 'round'
    target.lineJoin = 'round'
    target.beginPath()

    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]!
      const cx = markToCx(mark)
      const cy = markToCy(mark)
      if (i === 0) {
        target.moveTo(cx, cy)
      } else {
        const prev = marks[i - 1]!
        const dx = mark.x - prev.x
        const dy = mark.y - prev.y
        if (Math.hypot(dx, dy) > gapThreshold) {
          target.moveTo(cx, cy)
        } else {
          target.lineTo(cx, cy)
        }
      }
    }
    target.stroke()
  }

  const eraseStrokeRun = (
    target: CanvasRenderingContext2D,
    marks: AnnotationLayer['annotations'],
    radiusScale: number,
  ) => {
    if (!marks.length) return

    target.save()
    target.globalCompositeOperation = 'destination-out'
    target.strokeStyle = 'rgba(0,0,0,1)'
    target.lineCap = 'round'
    target.lineJoin = 'round'

    const avgRadius = marks.reduce((sum, mark) => sum + mark.radius, 0) / marks.length
    const lineWidth = Math.max(avgRadius * radiusScale * 2, 2)
    const gapThreshold = avgRadius * 4

    target.lineWidth = lineWidth
    target.beginPath()
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]!
      const cx = markToCx(mark)
      const cy = markToCy(mark)
      if (i === 0) {
        target.moveTo(cx, cy)
      } else {
        const prev = marks[i - 1]!
        const dx = mark.x - prev.x
        const dy = mark.y - prev.y
        if (Math.hypot(dx, dy) > gapThreshold) {
          target.moveTo(cx, cy)
        } else {
          target.lineTo(cx, cy)
        }
      }
    }
    target.stroke()
    target.restore()
  }

  const drawMarksInOrder = (
    target: CanvasRenderingContext2D,
    marks: AnnotationLayer['annotations'],
    layer: AnnotationLayer,
    radiusScale: number,
  ) => {
    let strokeRun: AnnotationLayer['annotations'] = []
    let runMode: 'add' | 'erase' | null = null

    const flushStrokeRun = () => {
      if (!strokeRun.length || !runMode) return
      if (runMode === 'erase') {
        eraseStrokeRun(target, strokeRun, radiusScale)
      } else {
        drawStrokeRun(target, strokeRun, layer, radiusScale)
      }
      strokeRun = []
      runMode = null
    }

    for (const mark of marks) {
      if (mark.contour && mark.contour.length > 1 && !mark.eraser) {
        flushStrokeRun()
        drawContourMark(target, mark, layer)
        continue
      }

      const nextMode: 'add' | 'erase' = mark.eraser ? 'erase' : 'add'
      if (runMode && runMode !== nextMode) {
        flushStrokeRun()
      }
      runMode = nextMode
      strokeRun.push(mark)
    }

    flushStrokeRun()
  }

  for (const layer of layers.filter((entry) => entry.visible)) {
    const marks = getSliceFromLayer(layer, view, sliceIndex)
    if (!marks.length) continue

    const radiusScale = useRotated ? transform.drawW / sourceHeight : transform.drawW / sourceWidth
    const hasEraserMarks = marks.some((m) => m.eraser)

    if (hasEraserMarks) {
      // Use offscreen canvas so eraser marks don't cut through the background image
      const offCanvas = document.createElement('canvas')
      offCanvas.width = canvas.width
      offCanvas.height = canvas.height
      const offCtx = offCanvas.getContext('2d')!
      drawMarksInOrder(offCtx, marks, layer, radiusScale)
      ctx.drawImage(offCanvas, 0, 0)
    } else {
      drawMarksInOrder(ctx, marks, layer, radiusScale)
    }
  }

  return { ...transform, rotated: useRotated, flip180, sourceWidth, sourceHeight }
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

  let localX = ((x - transform.drawX) / transform.drawW) * sourceWidth
  let localY = ((y - transform.drawY) / transform.drawH) * sourceHeight

  if (transform.flip180) {
    localX = sourceWidth - localX
    localY = sourceHeight - localY
  }

  return {
    x: clamp(localX, 0, sourceWidth - 1),
    y: clamp(localY, 0, sourceHeight - 1),
  }
}
