import type { AnnotationMark, ViewType } from '../types/viewer'

type SliceView = Exclude<ViewType, 'threeD'>

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

type SphereAnnotationMark = AnnotationMark & {
  centerX: number
  centerY: number
  centerZ: number
}

export const isSphereAnnotation = (mark: AnnotationMark): mark is SphereAnnotationMark =>
  isFiniteNumber(mark.centerX) &&
  isFiniteNumber(mark.centerY) &&
  isFiniteNumber(mark.centerZ)

export const slicePointToVolume = (
  view: SliceView,
  slice: number,
  x: number,
  y: number,
): { x: number; y: number; z: number } => {
  if (view === 'axial') return { x, y, z: slice }
  if (view === 'coronal') return { x, y: slice, z: y }
  return { x: slice, y: x, z: y }
}

export const volumePointToSlice = (
  view: SliceView,
  x: number,
  y: number,
  z: number,
): { slice: number; x: number; y: number } => {
  if (view === 'axial') return { slice: z, x, y }
  if (view === 'coronal') return { slice: y, x, y: z }
  return { slice: x, x: y, y: z }
}

/** Hashed, deterministic noise in [-1, 1] from three numeric inputs. */
const seedNoise = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

/** Build a slightly deformed circle contour (organic tumor look) around (cx, cy). */
const buildTumorContour = (
  cx: number,
  cy: number,
  radius: number,
  seedX: number,
  seedY: number,
  seedZ: number,
): Array<{ x: number; y: number }> => {
  const points = 32
  const result: Array<{ x: number; y: number }> = []
  // Three low-frequency components keep the boundary smooth but irregular.
  const amp1 = 0.05
  const amp2 = 0.035
  const amp3 = 0.025
  const phase1 = seedNoise(seedX, seedY, seedZ) * Math.PI
  const phase2 = seedNoise(seedY, seedZ, seedX) * Math.PI
  const phase3 = seedNoise(seedZ, seedX, seedY) * Math.PI
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const wobble =
      1 +
      amp1 * Math.sin(angle * 2 + phase1) +
      amp2 * Math.sin(angle * 3 + phase2) +
      amp3 * Math.sin(angle * 5 + phase3)
    const r = radius * wobble
    result.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r })
  }
  return result
}

export const projectAnnotationToSlice = (
  mark: AnnotationMark,
  view: SliceView,
  slice: number,
): AnnotationMark | null => {
  if (!isSphereAnnotation(mark)) {
    return mark.view === view && mark.slice === slice ? mark : null
  }

  const centerX = mark.centerX
  const centerY = mark.centerY
  const centerZ = mark.centerZ
  const center = volumePointToSlice(view, centerX, centerY, centerZ)
  const delta = slice - center.slice
  const projectedRadiusSquared = mark.radius * mark.radius - delta * delta
  if (projectedRadiusSquared <= 0) return null
  const projectedRadius = Math.sqrt(projectedRadiusSquared)

  const projected: AnnotationMark = {
    view,
    slice,
    x: center.x,
    y: center.y,
    radius: projectedRadius,
    eraser: mark.eraser,
  }

  if (mark.tumor && !mark.eraser && projectedRadius > 0.75) {
    projected.contour = buildTumorContour(center.x, center.y, projectedRadius, centerX, centerY, centerZ)
  }

  return projected
}

export const createSphereAnnotation = (
  x: number,
  y: number,
  z: number,
  radius: number,
): AnnotationMark => ({
  view: 'axial',
  slice: Math.round(z),
  x,
  y,
  radius,
  centerX: x,
  centerY: y,
  centerZ: z,
  tumor: true,
})
