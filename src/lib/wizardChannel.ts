import type { AiDetection, AnnotationLayer, AnnotationMark, BoundingBox, ViewType } from '../types/viewer'

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

export type WizardCommand = WozInjectDetection | WozSetProgress | WozCompleteProgress | WozResetAi

export interface ParticipantStatus {
  type: 'status-update'
  aiState: string
  aiMode: string
  aiProgress: number
  boundingBox: BoundingBox | null
  activeView: ViewType
  sliceIndex: number
  patientLoaded: boolean
  volumeDims: { width: number; height: number; depth: number } | null
  renderSettings: { windowCenter: number; windowWidth: number; contrast: number; threshold: number; inverted: boolean } | null
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

export type ParticipantMessage = ParticipantStatus | ParticipantAiRequested | ParticipantDetectionAction

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

// ── Prepared segmentation type ──

export interface PreparedSegmentation {
  id: string
  scenarioId: string
  label: string
  confidence: number
  regionHint: string
  name: string
  centerX: number
  centerY: number
  centerZ: number
  radius: number
  annotations: AnnotationMark[]
}
