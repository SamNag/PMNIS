import * as dicomParser from 'dicom-parser'
import * as nifti from 'nifti-reader-js'
import type { VolumeData } from '../types/viewer'
import { loadNiftiArrayBuffer } from './niftiLoader'

export interface LoadedMedicalMetadata {
  patientName?: string
  age?: number
  scanDate?: string
  studyType?: string
}

export interface LoadedMedicalFile {
  volume: VolumeData
  metadata: LoadedMedicalMetadata
}

const DICOM_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.2',
])

const clampToByte = (value: number): number => {
  if (value < 0) return 0
  if (value > 255) return 255
  return Math.round(value)
}

const sanitizeText = (value?: string): string | undefined => {
  const cleaned = value?.replace(/\0/g, '').trim()
  return cleaned ? cleaned : undefined
}

const sanitizePatientName = (value?: string): string | undefined => {
  const cleaned = sanitizeText(value)?.replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned : undefined
}

const parseDicomDate = (value?: string): string | undefined => {
  if (!value || !/^\d{8}$/.test(value)) return undefined
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

const parsePatientAge = (value?: string): number | undefined => {
  if (!value) return undefined
  const match = /^(\d{1,3})[DWMY]?$/i.exec(value.trim())
  if (!match) return undefined
  const age = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(age) ? age : undefined
}

const parsePixelSpacing = (value?: string): { spacingX: number; spacingY: number } => {
  if (!value) return { spacingX: 1, spacingY: 1 }
  const [rowSpacingRaw, columnSpacingRaw] = value
    .split('\\')
    .map((part) => Number.parseFloat(part))
  const rowSpacing = Number.isFinite(rowSpacingRaw) ? rowSpacingRaw : undefined
  const columnSpacing = Number.isFinite(columnSpacingRaw) ? columnSpacingRaw : undefined
  const spacingX = typeof columnSpacing === 'number' && columnSpacing > 0 ? columnSpacing : 1
  const spacingY = typeof rowSpacing === 'number' && rowSpacing > 0 ? rowSpacing : 1

  return {
    spacingX,
    spacingY,
  }
}

const getSequenceItem = (
  dataSet: dicomParser.DataSet,
  sequenceTag: string,
  index = 0,
): dicomParser.DataSet | null => {
  const sequence = dataSet.elements[sequenceTag]
  const item = sequence?.items?.[index]
  return item?.dataSet ?? null
}

const getDicomPositionFromSequence = (dataSet: dicomParser.DataSet, sequenceTag: string): number[] | null => {
  const sequenceItem = getSequenceItem(dataSet, sequenceTag)
  const position = sanitizeText(sequenceItem?.string('x00200032'))
  if (!position) return null

  const values = position.split('\\').map((part) => Number.parseFloat(part))
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return null
  return values
}

const getLikelyStudyType = (modality?: string): string | undefined => {
  if (!modality) return undefined
  if (modality === 'MR') return 'MRI'
  if (modality === 'CT') return 'CT'
  if (modality === 'US') return 'Ultrasound'
  return modality
}

const hasDicomPreamble = (data: ArrayBuffer): boolean => {
  if (data.byteLength < 132) return false
  const preamble = new Uint8Array(data, 128, 4)
  return preamble[0] === 68 && preamble[1] === 73 && preamble[2] === 67 && preamble[3] === 77
}

const isLikelyDicomFileName = (fileName: string): boolean => /\.(dcm|dicom)$/i.test(fileName)

const loadDicomArrayBuffer = (data: ArrayBuffer): LoadedMedicalFile => {
  const byteArray = new Uint8Array(data)
  const dataSet = dicomParser.parseDicom(byteArray)
  const firstPerFrame = getSequenceItem(dataSet, 'x52009230', 0)
  const secondPerFrame = getSequenceItem(dataSet, 'x52009230', 1)
  const firstPixelMeasures = firstPerFrame ? getSequenceItem(firstPerFrame, 'x00289110') : null

  const transferSyntax = sanitizeText(dataSet.string('x00020010'))
  if (transferSyntax && !DICOM_TRANSFER_SYNTAXES.has(transferSyntax)) {
    throw new Error(`Unsupported DICOM transfer syntax: ${transferSyntax}. Only uncompressed DICOM is supported.`)
  }

  const rows = dataSet.uint16('x00280010')
  const columns = dataSet.uint16('x00280011')
  const samplesPerPixel = dataSet.uint16('x00280002') ?? 1
  const bitsAllocated = dataSet.uint16('x00280100')
  const pixelRepresentation = dataSet.uint16('x00280103') ?? 0
  const photometricInterpretation = sanitizeText(dataSet.string('x00280004')) ?? 'MONOCHROME2'
  const pixelDataElement = dataSet.elements.x7fe00010

  if (!rows || !columns || !bitsAllocated || !pixelDataElement) {
    throw new Error('DICOM file is missing required image data tags.')
  }

  if (samplesPerPixel !== 1) {
    throw new Error('Only monochrome DICOM images are supported right now.')
  }

  if (photometricInterpretation !== 'MONOCHROME1' && photometricInterpretation !== 'MONOCHROME2') {
    throw new Error(`Unsupported DICOM photometric interpretation: ${photometricInterpretation}.`)
  }

  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`Unsupported DICOM bit depth: ${bitsAllocated}.`)
  }

  const bytesPerSample = bitsAllocated / 8
  const declaredFrames = Number.parseInt(sanitizeText(dataSet.string('x00280008')) ?? '1', 10)
  const pixelsPerFrame = rows * columns
  const inferredFrames = pixelDataElement.length / Math.max(1, pixelsPerFrame * bytesPerSample)
  const depth =
    Number.isFinite(declaredFrames) && declaredFrames > 0
      ? declaredFrames
      : Number.isFinite(inferredFrames) && inferredFrames > 0
        ? Math.round(inferredFrames)
        : 1

  const totalPixels = rows * columns * depth
  if (pixelDataElement.length < totalPixels * bytesPerSample) {
    throw new Error('DICOM pixel data is incomplete.')
  }

  const rescaleSlope =
    dataSet.floatString('x00281053') ??
    firstPixelMeasures?.floatString('x00281053') ??
    1
  const rescaleIntercept =
    dataSet.floatString('x00281052') ??
    firstPixelMeasures?.floatString('x00281052') ??
    0
  const scaledPixels = new Float32Array(totalPixels)
  let min = Infinity
  let max = -Infinity

  for (let i = 0; i < totalPixels; i += 1) {
    const byteOffset = pixelDataElement.dataOffset + i * bytesPerSample
    let rawValue = 0

    if (bitsAllocated === 16) {
      rawValue = pixelRepresentation === 0
        ? dataSet.byteArrayParser.readUint16(dataSet.byteArray, byteOffset)
        : dataSet.byteArrayParser.readInt16(dataSet.byteArray, byteOffset)
    } else {
      const byteValue = dataSet.byteArray[byteOffset] ?? 0
      rawValue = pixelRepresentation === 0 ? byteValue : (byteValue << 24) >> 24
    }

    const scaledValue = rawValue * rescaleSlope + rescaleIntercept
    scaledPixels[i] = scaledValue
    if (scaledValue < min) min = scaledValue
    if (scaledValue > max) max = scaledValue
  }

  const range = max - min || 1
  const mri = new Uint8Array(totalPixels)
  const mask = new Uint8Array(totalPixels)

  for (let i = 0; i < totalPixels; i += 1) {
    let normalized = ((scaledPixels[i]! - min) / range) * 255
    if (photometricInterpretation === 'MONOCHROME1') {
      normalized = 255 - normalized
    }
    mri[i] = clampToByte(normalized)
  }

  const { spacingX, spacingY } = parsePixelSpacing(
    sanitizeText(dataSet.string('x00280030')) ??
    sanitizeText(firstPixelMeasures?.string('x00280030')),
  )

  const firstPosition = firstPerFrame ? getDicomPositionFromSequence(firstPerFrame, 'x00209113') : null
  const secondPosition = secondPerFrame ? getDicomPositionFromSequence(secondPerFrame, 'x00209113') : null
  const positionSpacing =
    firstPosition && secondPosition
      ? Math.hypot(
          secondPosition[0]! - firstPosition[0]!,
          secondPosition[1]! - firstPosition[1]!,
          secondPosition[2]! - firstPosition[2]!,
        )
      : undefined

  const spacingZ =
    dataSet.floatString('x00180088') ??
    firstPixelMeasures?.floatString('x00180088') ??
    positionSpacing ??
    dataSet.floatString('x00180050') ??
    firstPixelMeasures?.floatString('x00180050') ??
    1

  return {
    volume: {
      width: columns,
      height: rows,
      depth,
      spacingX,
      spacingY,
      spacingZ: Number.isFinite(spacingZ) && spacingZ > 0 ? spacingZ : 1,
      mri,
      mask,
    },
    metadata: {
      patientName: sanitizePatientName(dataSet.string('x00100010')),
      age: parsePatientAge(sanitizeText(dataSet.string('x00101010'))),
      scanDate: parseDicomDate(
        sanitizeText(dataSet.string('x00080020')) ??
        sanitizeText(dataSet.string('x00080023')),
      ),
      studyType: getLikelyStudyType(sanitizeText(dataSet.string('x00080060'))),
    },
  }
}

export const loadMedicalFile = async (file: File): Promise<LoadedMedicalFile> => {
  const data = await file.arrayBuffer()

  if (nifti.isCompressed(data)) {
    const decompressed = nifti.decompress(data) as ArrayBuffer
    if (nifti.isNIFTI(decompressed)) {
      return { volume: loadNiftiArrayBuffer(decompressed), metadata: {} }
    }
  }

  if (nifti.isNIFTI(data)) {
    return { volume: loadNiftiArrayBuffer(data), metadata: {} }
  }

  const likelyDicom = hasDicomPreamble(data) || isLikelyDicomFileName(file.name)
  try {
    return loadDicomArrayBuffer(data)
  } catch (error) {
    if (likelyDicom) {
      throw error instanceof Error ? error : new Error('Failed to parse DICOM file.')
    }
  }

  throw new Error('Unsupported file format. Please upload a NIfTI (.nii, .nii.gz) or uncompressed DICOM (.dcm) file.')
}
