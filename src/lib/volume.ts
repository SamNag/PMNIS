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
  if (view === 'axial' || view === 'threeD') return volume.depth - 1
  if (view === 'coronal') return volume.height - 1
  if (view === 'sagittal') return volume.width - 1
  return 0
}

export const getDefaultSliceForView = (view: ViewType, volume: VolumeData): number =>
  view === 'threeD' ? getViewMaxSlice(view, volume) : Math.floor(getViewMaxSlice(view, volume) / 2)

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
  maxPoints = 200000000,
): Array<{ x: number; y: number; z: number }> => {
  const points: Array<{ x: number; y: number; z: number }> = []
  const step = 1

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

/**
 * Sample 3D points from MRI intensity data for volumetric rendering.
 * Samples points throughout the volume with intensity values for proper visualization.
 */
export const sampleMriSurfacePoints = (
  volume: VolumeData,
  maxPoints = 200000000,
): Array<{ x: number; y: number; z: number; intensity: number }> => {
  const points: Array<{ x: number; y: number; z: number; intensity: number }> = []

  // Find intensity statistics for adaptive thresholding
  let maxIntensity = 0
  let sumIntensity = 0
  let countNonZero = 0

  for (let i = 0; i < volume.mri.length; i++) {
    const val = volume.mri[i] ?? 0
    if (val > 0) {
      sumIntensity += val
      countNonZero++
      if (val > maxIntensity) maxIntensity = val
    }
  }

  const avgIntensity = countNonZero > 0 ? sumIntensity / countNonZero : 128

  // Very low threshold to include all visible tissue
  const minThreshold = Math.max(1, avgIntensity * 0.01)

  // Step size of 1 for maximum density
  const step = 1

  for (let z = 0; z < volume.depth; z += step) {
    for (let y = 0; y < volume.height; y += step) {
      for (let x = 0; x < volume.width; x += step) {
        const idx = index3d(x, y, z, volume.width, volume.height)
        const intensity = volume.mri[idx] ?? 0

        // Skip very low intensity voxels (background/air)
        if (intensity < minThreshold) continue

        // Normalize intensity to 0-1 range
        const normalizedIntensity = intensity / maxIntensity

        points.push({
          x: x / volume.width - 0.5,
          y: y / volume.height - 0.5,
          z: z / volume.depth - 0.5,
          intensity: normalizedIntensity,
        })

        if (points.length >= maxPoints) return points
      }
    }
  }

  return points
}

