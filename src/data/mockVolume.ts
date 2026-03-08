import type { VolumeData } from '../types/viewer'

const index3d = (x: number, y: number, z: number, width: number, height: number): number =>
  z * width * height + y * width + x

const clampToByte = (value: number): number => {
  if (value < 0) return 0
  if (value > 255) return 255
  return value
}

const pseudoNoise = (x: number, y: number, z: number): number => {
  const a = Math.sin(x * 0.17 + y * 0.11 + z * 0.07)
  const b = Math.cos(x * 0.13 - y * 0.19 + z * 0.05)
  const c = Math.sin((x + y + z) * 0.09)
  return (a + b + c) * 6
}

export const createMockBrainVolume = (): VolumeData => {
  const width = 128
  const height = 128
  const depth = 72
  const total = width * height * depth

  const mri = new Uint8Array(total)
  const mask = new Uint8Array(total)

  const cx = width * 0.5
  const cy = height * 0.5
  const cz = depth * 0.5

  const rx = width * 0.42
  const ry = height * 0.45
  const rz = depth * 0.47

  const tx = width * 0.62
  const ty = height * 0.46
  const tz = depth * 0.52
  const tr = width * 0.12

  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const brainNorm =
          ((x - cx) * (x - cx)) / (rx * rx) +
          ((y - cy) * (y - cy)) / (ry * ry) +
          ((z - cz) * (z - cz)) / (rz * rz)

        const i = index3d(x, y, z, width, height)
        if (brainNorm > 1.05) {
          mri[i] = 0
          mask[i] = 0
          continue
        }

        const corticalRim = Math.max(0, 1 - Math.abs(brainNorm - 0.9) * 3)
        const whiteMatter = Math.max(0, 1 - brainNorm)
        const intensity =
          24 + whiteMatter * 115 + corticalRim * 30 + pseudoNoise(x, y, z) + (z / depth) * 18

        const tumorDist = Math.sqrt((x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2)
        const edemaDist = Math.sqrt((x - (tx - 5)) ** 2 + (y - (ty + 4)) ** 2 + (z - tz) ** 2)

        let finalIntensity = intensity
        if (edemaDist < tr * 1.7) {
          finalIntensity += (1 - edemaDist / (tr * 1.7)) * 52
        }
        if (tumorDist < tr) {
          finalIntensity += (1 - tumorDist / tr) * 78
          mask[i] = 1
        }

        mri[i] = clampToByte(finalIntensity)
      }
    }
  }

  return { width, height, depth, mri, mask }
}
