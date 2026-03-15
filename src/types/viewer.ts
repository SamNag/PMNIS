export type LayoutMode = '2x2' | '3x1' | 'single'

export type ViewType = 'axial' | 'sagittal' | 'coronal' | 'threeD'

export type ToolId =
  | 'zoom'
  | 'pan'
  | 'windowLevel'
  | 'threshold'
  | 'contrast'
  | 'fit'
  | 'reset'
  | 'invert'
  | 'brush'
  | 'lasso'
  | 'eraser'
  | 'polygon'
  | 'contour'
  | 'fill'
  | 'clearSelection'

export type ToolbarSection = 'image' | 'manual' | 'ai' | 'general'

export type LayerType = 'manual' | 'ai'

export type AiMode = 'full' | 'semi'

export type AiState = 'idle' | 'running' | 'success' | 'rejected'

export interface VolumeData {
  width: number
  height: number
  depth: number
  spacingX?: number
  spacingY?: number
  spacingZ?: number
  mri: Uint8Array
  mask: Uint8Array
}

export interface Patient {
  id: string
  name: string
  age: number
  scanDate: string
  studyType: string
}

export interface ViewportState {
  id: string
  label: string
  assignedView: ViewType
  sliceIndex: number
}

export interface AnnotationMark {
  view: Exclude<ViewType, 'threeD'>
  slice: number
  x: number
  y: number
  radius: number
}

export interface AnnotationLayer {
  id: string
  name: string
  type: LayerType
  visible: boolean
  color: string
  annotations: AnnotationMark[]
}

export interface RenderSettings {
  zoom: number
  panX: number
  panY: number
  windowCenter: number
  windowWidth: number
  contrast: number
  threshold: number
  inverted: boolean
}
