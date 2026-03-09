import * as nifti from 'nifti-reader-js'
import type { VolumeData } from '../types/viewer'

const clampToByte = (value: number): number => {
  if (value < 0) return 0
  if (value > 255) return 255
  return Math.round(value)
}

export const loadNiftiFile = async (file: File): Promise<VolumeData> => {
  let data: ArrayBuffer = await file.arrayBuffer()

  // Check if compressed
  if (nifti.isCompressed(data)) {
    data = nifti.decompress(data) as ArrayBuffer
  }

  if (!nifti.isNIFTI(data)) {
    throw new Error('Not a valid NIfTI file')
  }

  const header = nifti.readHeader(data)
  if (!header) {
    throw new Error('Could not read NIfTI header')
  }

  const image = nifti.readImage(header, data)

  // Get dimensions
  const width = header.dims[1] ?? 1
  const height = header.dims[2] ?? 1
  const depth = header.dims[3] ?? 1
  const total = width * height * depth

  // Convert image data to typed array based on datatype
  let typedData: Float32Array | Int16Array | Uint8Array | Int32Array | Uint16Array | Float64Array

  switch (header.datatypeCode) {
    case nifti.NIFTI1.TYPE_UINT8:
      typedData = new Uint8Array(image)
      break
    case nifti.NIFTI1.TYPE_INT16:
      typedData = new Int16Array(image)
      break
    case nifti.NIFTI1.TYPE_INT32:
      typedData = new Int32Array(image)
      break
    case nifti.NIFTI1.TYPE_FLOAT32:
      typedData = new Float32Array(image)
      break
    case nifti.NIFTI1.TYPE_FLOAT64:
      typedData = new Float64Array(image)
      break
    case nifti.NIFTI1.TYPE_UINT16:
      typedData = new Uint16Array(image)
      break
    default:
      // Default to Float32
      typedData = new Float32Array(image)
  }

  // Find min and max for normalization
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < typedData.length; i++) {
    const val = typedData[i]!
    if (val < min) min = val
    if (val > max) max = val
  }

  // Normalize to 0-255 range
  const range = max - min || 1
  const mri = new Uint8Array(total)
  const mask = new Uint8Array(total) // Empty mask for now

  for (let i = 0; i < total; i++) {
    const normalized = ((typedData[i]! - min) / range) * 255
    mri[i] = clampToByte(normalized)
  }

  return { width, height, depth, mri, mask }
}


