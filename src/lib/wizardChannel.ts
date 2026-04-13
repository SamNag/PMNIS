import type { AiDetection, AnnotationLayer, AnnotationMark, BoundingBox, LayoutMode, ViewType } from '../types/viewer'

// ── Message types ──

export interface WozInjectDetection {
  type: 'inject-detection'
  layer: AnnotationLayer
  detection: AiDetection
}

export interface WozSetProgress {
  type: 'set-progress'
  value: number
}

export interface WozCompleteProgress {
  type: 'complete-progress'
}

export interface WozResetAi {
  type: 'reset-ai'
}

export interface WozShowTaskRating {
  type: 'show-task-rating'
  question?: string
}

export type WizardCommand = WozInjectDetection | WozSetProgress | WozCompleteProgress | WozResetAi | WozShowTaskRating

export interface ParticipantStatus {
  type: 'status-update'
  aiState: string
  aiMode: string
  aiProgress: number
  boundingBox: BoundingBox | null
  activeView: ViewType
  sliceIndex: number
  /** Per-view slice indices so the wizard can mirror all three planes simultaneously. */
  viewSlices: { axial: number; coronal: number; sagittal: number }
  /** Participant layout mode (3x1 or single). */
  layout: LayoutMode
  /** Visible viewports the participant currently has on screen. */
  visibleViewports: Array<{ id: string; assignedView: ViewType; sliceIndex: number }>
  patientLoaded: boolean
  volumeDims: { width: number; height: number; depth: number } | null
  renderSettings: { windowCenter: number; windowWidth: number; contrast: number; threshold: number; inverted: boolean } | null
  flipCorSag: boolean
}

export interface ParticipantAiRequested {
  type: 'ai-requested'
  mode: string
  boundingBox: BoundingBox | null
}

export interface ParticipantDetectionAction {
  type: 'detection-action'
  action: 'accepted' | 'rejected' | 'edited'
  detectionId: string
}

export interface ParticipantVolumeChanged {
  type: 'volume-changed'
  fileName: string
}

export type ParticipantMessage = ParticipantStatus | ParticipantAiRequested | ParticipantDetectionAction | ParticipantVolumeChanged

// ── Wizard → Participant ──

export function sendWizardCommand(cmd: WizardCommand): Promise<void> {
  return fetch('/woz/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  }).then(() => undefined)
}

export function listenForCommands(callback: (cmd: WizardCommand) => void): () => void {
  const es = new EventSource('/woz/events')
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type && data.type !== 'connected') {
        callback(data as WizardCommand)
      }
    } catch { /* ignore parse errors */ }
  }
  return () => es.close()
}

// ── Participant → Wizard ──

export function sendParticipantMessage(msg: ParticipantMessage): Promise<void> {
  return fetch('/woz/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).then(() => undefined)
}

export function listenForStatus(callback: (msg: ParticipantMessage) => void): () => void {
  const es = new EventSource('/woz/status-events')
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type && data.type !== 'connected') {
        callback(data as ParticipantMessage)
      }
    } catch { /* ignore parse errors */ }
  }
  return () => es.close()
}

// ── Volume file relay ──

export function uploadVolumeForWizard(file: File): Promise<void> {
  return file.arrayBuffer().then((buf) =>
    fetch('/woz/upload-volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
      body: buf,
    }).then(() => undefined),
  )
}

export async function downloadWizardVolume(): Promise<File | null> {
  const res = await fetch('/woz/volume')
  if (!res.ok) return null
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="(.+)"/.exec(disposition)
  const name = match?.[1] ?? 'volume.bin'
  const blob = await res.blob()
  return new File([blob], name, { type: 'application/octet-stream' })
}

// ── Prepared segmentation type ──

export interface PreparedSegmentation {
  id: string
  scenarioId: string
  label: string
  confidence: number
  confidenceLabel?: string
  confidenceReason?: string
  regionHint: string
  name: string
  centerX: number
  centerY: number
  centerZ: number
  radius: number
  annotations: AnnotationMark[]
}
