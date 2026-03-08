import type { ViewType, VolumeData } from '../types/viewer'

const index3d = (x: number, y: number, z: number, width: number, height: number): number =>
  z * width * height + y * width + x

export const getSliceSize = (
  view: Exclude<ViewType, 'threeD'>,
  volume: VolumeData,
): { width: number; height: number } => {
  if (view === 'axial') return { width: volume.width, height: volume.height }
  if (view === 'coronal') return { width: volume.width, height: volume.depth }
  return { width: volume.height, height: volume.depth }
}

export const getViewMaxSlice = (view: ViewType, volume: VolumeData): number => {
  if (view === 'axial') return volume.depth - 1
  if (view === 'coronal') return volume.height - 1
  if (view === 'sagittal') return volume.width - 1
  return 0
}

export const getDefaultSliceForView = (view: ViewType, volume: VolumeData): number =>
  Math.floor(getViewMaxSlice(view, volume) / 2)

export const readVoxelByView = (
  view: Exclude<ViewType, 'threeD'>,
  sx: number,
  sy: number,
  sliceIndex: number,
  volume: VolumeData,
): { mri: number; mask: number } => {
  let x = 0
  let y = 0
  let z = 0

  if (view === 'axial') {
    x = sx
    y = sy
    z = sliceIndex
  } else if (view === 'coronal') {
    x = sx
    y = sliceIndex
    z = sy
  } else {
    x = sliceIndex
    y = sx
    z = sy
  }

  const idx = index3d(x, y, z, volume.width, volume.height)
  return { mri: volume.mri[idx] ?? 0, mask: volume.mask[idx] ?? 0 }
}

export const sampleMaskPoints = (
  volume: VolumeData,
  maxPoints = 1800,
): Array<{ x: number; y: number; z: number }> => {
  const points: Array<{ x: number; y: number; z: number }> = []
  const step = 2

  for (let z = 0; z < volume.depth; z += step) {
    for (let y = 0; y < volume.height; y += step) {
      for (let x = 0; x < volume.width; x += step) {
        const idx = index3d(x, y, z, volume.width, volume.height)
        if (!volume.mask[idx]) continue

        points.push({
          x: x / volume.width - 0.5,
          y: y / volume.height - 0.5,
          z: z / volume.depth - 0.5,
        })

        if (points.length >= maxPoints) return points
      }
    }
  }

  return points
}
