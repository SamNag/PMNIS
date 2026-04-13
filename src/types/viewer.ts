export type LayoutMode = '3x1' | 'single'

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
  | 'boundingBox'

export type ToolbarSection = 'image' | 'manual' | 'general'

export type LayerType = 'manual' | 'ai' | 'folder'

export type AiMode = 'full' | 'semi'

export interface BoundingBox {
  view: Exclude<ViewType, 'threeD'>
  slice: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export type AiState = 'idle' | 'running' | 'success' | 'rejected'

export interface VolumeData {
  width: number
  height: number
  depth: number
  spacingX?: number
  spacingY?: number
  spacingZ?: number
  /** When true, coronal and sagittal views are drawn rotated 180 degrees (NIfTI RAS convention). */
  flipCorSag?: boolean
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
  /** When present, treat this mark as a 3D sphere centered in voxel space. */
  centerX?: number
  centerY?: number
  centerZ?: number
  /** Irregular contour polygon for AI detections (slice-space coordinates). */
  contour?: Array<{ x: number; y: number }>
  /** When true, this mark erases (subtracts) from the annotation area. */
  eraser?: boolean
}

export interface AnnotationLayer {
  id: string
  name: string
  type: LayerType
  visible: boolean
  color: string
  annotations: AnnotationMark[]
  /** Children layers for folder type. */
  children?: AnnotationLayer[]
  /** Whether folder is expanded in UI. */
  expanded?: boolean
  /** Creation timestamp for work history ordering. */
  timestamp?: number
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

export type DetectionStatus = 'pending' | 'accepted' | 'rejected'

export interface AiDetection {
  id: string
  name: string
  label: string
  confidence: number
  confidenceLabel?: string
  confidenceReason?: string
  centerX: number
  centerY: number
  centerZ: number
  radius: number
  status: DetectionStatus
  layerId: string
  color: string
  /** Whether the user edited this detection before accepting. */
  wasEdited?: boolean
}

// ── Feedback ──

export type FeedbackType = 'full-auto-rating' | 'semi-reject-reason' | 'semi-edit-accept'

export interface FeedbackPopupState {
  visible: boolean
  type: FeedbackType
  /** Related detection id (for semi-auto feedback). */
  detectionId?: string
  detectionName?: string
}

export type RejectReason =
  | 'false-positive'
  | 'wrong-boundary'
  | 'wrong-label'
  | 'other'

export type EditAcceptAnswer =
  | 'ai-too-big'
  | 'ai-missed-area'
  | 'both'
  | 'minor-adjustment'

export interface FeedbackEntry {
  id: string
  timestamp: number
  type: FeedbackType
  /** Star rating 0.5–5 for full-auto mode. */
  rating?: number
  /** Reason for rejecting a detection. */
  rejectReason?: RejectReason
  rejectComment?: string
  /** Answer about edit nature. */
  editAcceptAnswer?: EditAcceptAnswer
  /** Related detection id. */
  detectionId?: string
  detectionName?: string
}

// ── Accounts & Roles ──

export type UserRole = 'doctor' | 'student'

export interface UserAccount {
  id: string
  name: string
  role: UserRole
  initials: string
  avatarColor: string
}

// ── Student Learning ──

export interface EducationalDescription {
  title: string
  pathology: string
  imagingFeatures: string
  clinicalContext: string
}
