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

  return {
    view,
    slice,
    x: center.x,
    y: center.y,
    radius: Math.sqrt(projectedRadiusSquared),
    eraser: mark.eraser,
  }
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
})
