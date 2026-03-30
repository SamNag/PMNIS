/// <reference types="vite/client" />

declare module 'dicom-parser' {
  export interface SequenceItem {
    dataSet: DataSet
  }

  export interface DicomElement {
    dataOffset: number
    length: number
    items?: SequenceItem[]
  }

  export interface ByteArrayParser {
    readUint16(byteArray: Uint8Array, position: number): number
    readInt16(byteArray: Uint8Array, position: number): number
  }

  export interface DataSet {
    byteArray: Uint8Array
    byteArrayParser: ByteArrayParser
    elements: Record<string, DicomElement | undefined>
    string(tag: string): string | undefined
    uint16(tag: string, index?: number): number | undefined
    floatString(tag: string): number | undefined
  }

  export function parseDicom(byteArray: Uint8Array): DataSet
}
