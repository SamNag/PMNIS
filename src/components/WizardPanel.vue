<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import {
  listenForStatus,
  sendWizardCommand,
  downloadWizardVolume,
  type ParticipantMessage,
  type PreparedSegmentation,
} from '../lib/wizardChannel'
import { makeId } from '../lib/ids'
import { exportWozLog, wozLog } from '../lib/wizardLog'
import { preparedSegmentations } from '../data/wizardSegmentations'
import { loadMedicalFile } from '../lib/medicalLoader'
import { createSphereAnnotation } from '../lib/annotations'
import { getSliceSize, getViewMaxSlice } from '../lib/volume'
import type { AiDetection, AnnotationLayer, AnnotationMark, BoundingBox, ViewType, VolumeData } from '../types/viewer'

// ── Volume data (loaded independently by wizard) ──
const volume = ref<VolumeData | null>(null)
const volumeLoading = ref(false)
const volumeFileName = ref('')

const loadVolumeFromFile = async (file: File) => {
  volumeLoading.value = true
  try {
    const result = await loadMedicalFile(file)
    volume.value = result.volume
    volumeFileName.value = file.name
  } catch (e) {
    console.error('Failed to load volume:', e)
  }
  volumeLoading.value = false
}

const loadDefaultVolume = async () => {
  volumeLoading.value = true
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}BraTS20_Training_002_t1ce.nii`)
    const blob = await response.blob()
    const file = new File([blob], 'BraTS20_Training_002_t1ce.nii', { type: 'application/octet-stream' })
    await loadVolumeFromFile(file)
  } catch (e) {
    console.error('Failed to load default volume:', e)
    volumeLoading.value = false
  }
}

const loadVolumeFromRelay = async () => {
  volumeLoading.value = true
  try {
    const file = await downloadWizardVolume()
    if (file) {
      await loadVolumeFromFile(file)
    }
  } catch (e) {
    console.error('Failed to download volume from relay:', e)
  }
  volumeLoading.value = false
}

// ── Participant status ──
const participantState = ref<{
  aiState: string
  aiMode: string
  aiProgress: number
  boundingBox: BoundingBox | null
  activeView: string
  sliceIndex: number
  patientLoaded: boolean
  volumeDims: { width: number; height: number; depth: number } | null
  renderSettings: { windowCenter: number; windowWidth: number; contrast: number; threshold: number; inverted: boolean } | null
  flipCorSag: boolean
}>({
  aiState: 'idle',
  aiMode: 'full',
  aiProgress: 0,
  boundingBox: null,
  activeView: 'axial',
  sliceIndex: 0,
  patientLoaded: false,
  volumeDims: null,
  renderSettings: null,
  flipCorSag: false,
})

type WizardSliceView = Exclude<ViewType, 'threeD'>
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const activeMirrorView = computed<WizardSliceView | null>(() => (
  participantState.value.activeView === 'threeD'
    ? null
    : participantState.value.activeView as WizardSliceView
))

const selectedInsertSlice = ref(0)

const maxInsertSlice = computed(() => (
  activeMirrorView.value && volume.value
    ? getViewMaxSlice(activeMirrorView.value, volume.value)
    : 0
))

const displaySliceIndex = computed(() => clamp(selectedInsertSlice.value, 0, maxInsertSlice.value))

const syncInsertSliceToParticipant = () => {
  if (!activeMirrorView.value || !volume.value) return
  selectedInsertSlice.value = clamp(
    participantState.value.sliceIndex,
    0,
    getViewMaxSlice(activeMirrorView.value, volume.value),
  )
}

const lastAiRequest = ref<{
  mode: string
  boundingBox: BoundingBox | null
  timestamp: number
} | null>(null)

const eventLog = ref<Array<{ time: string; event: string; detail: string }>>([])

const addLog = (event: string, detail: string = '') => {
  const now = new Date()
  const time = now.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  eventLog.value.unshift({ time, event, detail })
  if (eventLog.value.length > 50) eventLog.value.pop()
}

// ── SSE listener ──
let cleanup: (() => void) | null = null

onMounted(() => {
  loadDefaultVolume()

  cleanup = listenForStatus((msg: ParticipantMessage) => {
    if (msg.type === 'status-update') {
      participantState.value = {
        aiState: msg.aiState,
        aiMode: msg.aiMode,
        aiProgress: msg.aiProgress,
        boundingBox: msg.boundingBox,
        activeView: msg.activeView,
        sliceIndex: msg.sliceIndex,
        patientLoaded: msg.patientLoaded,
        volumeDims: msg.volumeDims,
        renderSettings: msg.renderSettings,
        flipCorSag: msg.flipCorSag,
      }
    } else if (msg.type === 'ai-requested') {
      lastAiRequest.value = {
        mode: msg.mode,
        boundingBox: msg.boundingBox,
        timestamp: Date.now(),
      }
      addLog('AI Requested', `${msg.mode}${msg.boundingBox ? ` | ${msg.boundingBox.view} s${msg.boundingBox.slice}` : ' | full auto'}`)
      wozLog('ai-requested-by-participant', {
        mode: msg.mode,
        boundingBox: msg.boundingBox ? { ...msg.boundingBox } : null,
      })
    } else if (msg.type === 'detection-action') {
      addLog(`${msg.action}`, `Detection ${msg.detectionId.slice(0, 8)}`)
      wozLog(`participant-${msg.action}`, { detectionId: msg.detectionId })
    } else if (msg.type === 'volume-changed') {
      addLog('Volume changed', msg.fileName)
      loadVolumeFromRelay()
    }
  })
  addLog('Connected', 'Listening for participant')
})

onUnmounted(() => {
  if (cleanup) cleanup()
})

// ── Canvas rendering ──
const mirrorCanvas = ref<HTMLCanvasElement | null>(null)

const renderMirror = () => {
  const canvas = mirrorCanvas.value
  const vol = volume.value
  if (!canvas || !vol) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const view = activeMirrorView.value
  if (!view) return

  const sliceIndex = displaySliceIndex.value
  const { width: sw, height: sh } = getSliceSize(view, vol)

  const rect = canvas.parentElement!.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const cw = Math.floor(rect.width * dpr)
  const ch = Math.floor(rect.height * dpr)
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw
    canvas.height = ch
  }
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`

  const rs = participantState.value.renderSettings
  const wc = rs?.windowCenter ?? 112
  const ww = rs?.windowWidth ?? 220
  const ct = rs?.contrast ?? 1
  const th = rs?.threshold ?? 0
  const inv = rs?.inverted ?? false

  const buffer = new ImageData(sw, sh)
  const data = buffer.data
  const mri = vol.mri
  const vw = vol.width
  const vh = vol.height

  let baseIdx: number, strideX: number, strideY: number
  if (view === 'axial') { baseIdx = sliceIndex * vw * vh; strideX = 1; strideY = vw }
  else if (view === 'coronal') { baseIdx = sliceIndex * vw; strideX = 1; strideY = vw * vh }
  else { baseIdx = sliceIndex; strideX = vw; strideY = vw * vh }

  const wMin = wc - ww * 0.5
  const wMax = wc + ww * 0.5

  for (let y = 0; y < sh; y++) {
    const rowIdx = baseIdx + y * strideY
    for (let x = 0; x < sw; x++) {
      const idx = rowIdx + x * strideX
      const mriVal = mri[idx] ?? 0
      let gray = clamp(((mriVal - wMin) / (wMax - wMin)) * 255, 0, 255)
      gray = clamp((gray - 128) * ct + 128, 0, 255)
      if (gray < th) gray = 0
      if (inv) gray = 255 - gray
      const pixel = (y * sw + x) * 4
      data[pixel] = gray; data[pixel + 1] = gray; data[pixel + 2] = gray; data[pixel + 3] = 255
    }
  }

  const scale = Math.min(cw / sw, ch / sh)
  const drawW = sw * scale
  const drawH = sh * scale
  const drawX = (cw - drawW) * 0.5
  const drawY = (ch - drawH) * 0.5
  const flip = !!(participantState.value.flipCorSag && view !== 'axial')

  canvasTransform.value = { drawX, drawY, drawW, drawH, sourceW: sw, sourceH: sh, flip }

  ctx.fillStyle = '#18181b'
  ctx.fillRect(0, 0, cw, ch)

  const offscreen = document.createElement('canvas')
  offscreen.width = sw; offscreen.height = sh
  offscreen.getContext('2d')!.putImageData(buffer, 0, 0)
  ctx.imageSmoothingEnabled = false

  if (flip) {
    ctx.save()
    ctx.translate(drawX + drawW * 0.5, drawY + drawH * 0.5)
    ctx.rotate(Math.PI)
    ctx.drawImage(offscreen, -drawW * 0.5, -drawH * 0.5, drawW, drawH)
    ctx.restore()
  } else {
    ctx.drawImage(offscreen, drawX, drawY, drawW, drawH)
  }

  // Draw staged tumors as preview circles
  for (const item of stagedTumors.value) {
    let sx: number, sy: number, axisDistance: number
    if (view === 'axial') {
      sx = item.cx
      sy = item.cy
      axisDistance = Math.abs(item.cz - sliceIndex)
    } else if (view === 'coronal') {
      sx = item.cx
      sy = item.cz
      axisDistance = Math.abs(item.cy - sliceIndex)
    } else {
      sx = item.cy
      sy = item.cz
      axisDistance = Math.abs(item.cx - sliceIndex)
    }

    const crossSectionRadiusSq = item.radius * item.radius - axisDistance * axisDistance
    if (crossSectionRadiusSq <= 0) continue
    const crossSectionRadius = Math.sqrt(crossSectionRadiusSq)

    const csX = flip ? drawX + ((sw - sx) / sw) * drawW : drawX + (sx / sw) * drawW
    const csY = flip ? drawY + ((sh - sy) / sh) * drawH : drawY + (sy / sh) * drawH
    const csR = (crossSectionRadius / sw) * drawW

    ctx.beginPath()
    ctx.arc(csX, csY, csR, 0, Math.PI * 2)
    ctx.fillStyle = `${item.color}33`
    ctx.fill()
    ctx.strokeStyle = `${item.color}aa`
    ctx.lineWidth = 2 * dpr
    ctx.setLineDash([4 * dpr, 3 * dpr])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Draw bounding box overlay
  const sliceToCanvasX = (ssx: number) => { const nx = flip ? (sw - ssx) : ssx; return drawX + (nx / sw) * drawW }
  const sliceToCanvasY = (ssy: number) => { const ny = flip ? (sh - ssy) : ssy; return drawY + (ny / sh) * drawH }

  const box = participantState.value.boundingBox
  if (box && box.view === view && box.slice === sliceIndex) {
    const bx1 = sliceToCanvasX(Math.min(box.x1, box.x2))
    const by1 = sliceToCanvasY(Math.min(box.y1, box.y2))
    const bx2 = sliceToCanvasX(Math.max(box.x1, box.x2))
    const by2 = sliceToCanvasY(Math.max(box.y1, box.y2))
    const rx = Math.min(bx1, bx2), ry = Math.min(by1, by2)
    const rw = Math.abs(bx2 - bx1), rh = Math.abs(by2 - by1)
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2 * dpr
    ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([])
    ctx.fillStyle = 'rgba(250, 204, 21, 0.08)'; ctx.fillRect(rx, ry, rw, rh)
  }

  ctx.font = `bold ${14 * dpr}px system-ui`
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(`${view.toUpperCase()} — slice ${sliceIndex}`, 8 * dpr, 20 * dpr)
}

const canvasTransform = ref<{ drawX: number; drawY: number; drawW: number; drawH: number; sourceW: number; sourceH: number; flip: boolean } | null>(null)


// ── Confidence presets ──
interface ConfidencePreset { id: string; label: string; value: number; color: string; explanation: string }

const confidencePresets: ConfidencePreset[] = [
  { id: 'very-high', label: 'Very High', value: 0.95, color: '#22c55e',
    explanation: 'Strong contrast enhancement with well-defined margins. Consistent shape across adjacent slices. Signal characteristics highly consistent with neoplastic tissue.' },
  { id: 'high', label: 'High', value: 0.87, color: '#3b82f6',
    explanation: 'Moderate contrast enhancement observed. Mostly well-defined boundaries with minor irregularities. Good slice-to-slice continuity suggests a true finding.' },
  { id: 'moderate', label: 'Moderate', value: 0.72, color: '#f59e0b',
    explanation: 'Subtle enhancement detected. Some boundary ambiguity — adjacent tissue shows similar intensity. Clinical correlation recommended to confirm finding.' },
  { id: 'low', label: 'Low', value: 0.58, color: '#ef4444',
    explanation: 'Minimal contrast difference from surrounding tissue. Irregular margins may indicate artifact or normal anatomical variant. Further sequences recommended.' },
]

const selectedConfidence = ref<ConfidencePreset>(confidencePresets[0]!)

watch(
  [activeMirrorView, volume],
  ([view, vol], previous) => {
    if (!view || !vol) return
    const prevView = previous?.[0]
    if (view !== prevView || selectedInsertSlice.value > getViewMaxSlice(view, vol)) {
      selectedInsertSlice.value = clamp(participantState.value.sliceIndex, 0, getViewMaxSlice(view, vol))
    }
  },
  { immediate: true },
)

// ── Tumor size presets ──
interface SizePreset { id: string; label: string; desc: string; radius: number }

const sizePresets: SizePreset[] = [
  { id: 's', label: 'S — Small', desc: 'Micro-lesion', radius: 4 },
  { id: 'm', label: 'M — Medium', desc: 'Focal tumor', radius: 8 },
  { id: 'l', label: 'L — Large', desc: 'Broader focus', radius: 12 },
  { id: 'xl', label: 'XL — Largest', desc: 'Max staging size', radius: 16 },
]

const selectedSize = ref<SizePreset>(sizePresets[1]!)

const createSphereAnnotations = (cx: number, cy: number, cz: number, radius: number): AnnotationMark[] => [
  createSphereAnnotation(cx, cy, cz, radius),
]

// ── Staging area: wizard places tumors, then injects all at once ──
interface StagedTumor {
  id: string
  cx: number
  cy: number
  cz: number
  radius: number
  confidence: number
  confidenceLabel: string
  confidenceReason: string
  name: string
  color: string
}

const stagedTumors = ref<StagedTumor[]>([])

// Re-render mirror when state changes (placed here after stagedTumors declaration)
watch(
  [() => participantState.value.activeView, () => participantState.value.sliceIndex, () => participantState.value.boundingBox, () => participantState.value.renderSettings, () => participantState.value.flipCorSag, volume, () => stagedTumors.value.length],
  () => { nextTick(renderMirror) },
  { deep: true },
)

onMounted(() => {
  const ro = new ResizeObserver(() => renderMirror())
  watch(mirrorCanvas, (el) => { if (el?.parentElement) ro.observe(el.parentElement) }, { immediate: true })
  onUnmounted(() => ro.disconnect())
})

const nameOptions = ['Tumor Candidate', 'Suspicious Focus', 'Lesion Candidate', 'Enhancing Region']
const detectionColors = ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']

const canvasToSliceCoords = (clientX: number, clientY: number): { sx: number; sy: number } | null => {
  const canvas = mirrorCanvas.value; const t = canvasTransform.value
  if (!canvas || !t) return null
  const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1
  const px = (clientX - rect.left) * dpr; const py = (clientY - rect.top) * dpr
  let sx = ((px - t.drawX) / t.drawW) * t.sourceW; let sy = ((py - t.drawY) / t.drawH) * t.sourceH
  if (t.flip) { sx = t.sourceW - sx; sy = t.sourceH - sy }
  if (sx < 0 || sx >= t.sourceW || sy < 0 || sy >= t.sourceH) return null
  return { sx, sy }
}

const stageAtPosition = (sx: number, sy: number) => {
  const vol = volume.value; if (!vol) return
  const view = activeMirrorView.value
  if (!view) return
  const sliceIndex = displaySliceIndex.value
  let cx: number, cy: number, cz: number
  if (view === 'axial') { cx = sx; cy = sy; cz = sliceIndex }
  else if (view === 'coronal') { cx = sx; cy = sliceIndex; cz = sy }
  else { cx = sliceIndex; cy = sx; cz = sy }

  stagedTumors.value.push({
    id: makeId('stg'),
    cx, cy, cz,
    radius: selectedSize.value.radius,
    confidence: selectedConfidence.value.value,
    confidenceLabel: selectedConfidence.value.label,
    confidenceReason: selectedConfidence.value.explanation,
    name: nameOptions[Math.floor(Math.random() * nameOptions.length)]!,
    color: detectionColors[stagedTumors.value.length % detectionColors.length]!,
  })
  addLog('Staged', `r=${selectedSize.value.radius} at (${Math.round(cx)},${Math.round(cy)},${Math.round(cz)})`)
}

const removeStagedTumor = (id: string) => {
  stagedTumors.value = stagedTumors.value.filter((t) => t.id !== id)
}

const injectAllStaged = () => {
  const vol = volume.value
  if (!vol || stagedTumors.value.length === 0) return

  for (const item of stagedTumors.value) {
    const layerId = makeId('ai')
    const detId = makeId('det')
    const annotations = createSphereAnnotations(item.cx, item.cy, item.cz, item.radius)
    const layer: AnnotationLayer = { id: layerId, name: item.name, type: 'ai', visible: true, color: item.color, annotations }
    const detection: AiDetection = {
      id: detId, name: item.name, label: 'Tumor', confidence: item.confidence,
      confidenceLabel: item.confidenceLabel, confidenceReason: item.confidenceReason,
      centerX: item.cx, centerY: item.cy, centerZ: item.cz, radius: item.radius,
      status: 'pending', layerId, color: item.color,
    }
    sendWizardCommand({ type: 'inject-detection', layer, detection })
    wozLog('wizard-injected', { cx: item.cx, cy: item.cy, cz: item.cz, radius: item.radius, confidence: item.confidence })
  }

  addLog('Injected', `${stagedTumors.value.length} tumor(s) sent to participant`)
  stagedTumors.value = []
}

// Drag state
const isDragging = ref(false)
const dragPreviewPos = ref<{ x: number; y: number } | null>(null)

const onDragStart = (e: DragEvent) => {
  isDragging.value = true
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs='
  e.dataTransfer?.setDragImage(img, 0, 0)
  e.dataTransfer!.effectAllowed = 'copy'
}

const onDragOver = (e: DragEvent) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; dragPreviewPos.value = { x: e.clientX, y: e.clientY } }
const onDragLeave = () => { dragPreviewPos.value = null }

const onDrop = (e: DragEvent) => {
  e.preventDefault(); isDragging.value = false; dragPreviewPos.value = null
  const coords = canvasToSliceCoords(e.clientX, e.clientY)
  if (coords) stageAtPosition(coords.sx, coords.sy)
}

const onDragEnd = () => { isDragging.value = false; dragPreviewPos.value = null }
const onCanvasClick = (e: MouseEvent) => { const coords = canvasToSliceCoords(e.clientX, e.clientY); if (coords) stageAtPosition(coords.sx, coords.sy) }

// ── Prepared segmentations ──
const injectFromPrepared = (seg: PreparedSegmentation) => {
  const layerId = makeId('ai'); const detId = makeId('det')
  const color = detectionColors[Math.floor(Math.random() * detectionColors.length)]!
  const layer: AnnotationLayer = { id: layerId, name: seg.name, type: 'ai', visible: true, color, annotations: seg.annotations }
  const detection: AiDetection = {
    id: detId,
    name: seg.name,
    label: seg.label,
    confidence: seg.confidence,
    confidenceLabel: seg.confidenceLabel,
    confidenceReason: seg.confidenceReason,
    centerX: seg.centerX,
    centerY: seg.centerY,
    centerZ: seg.centerZ,
    radius: seg.radius,
    status: 'pending',
    layerId,
    color,
  }
  sendWizardCommand({ type: 'inject-detection', layer, detection })
  addLog('Injected prepared', `${seg.label}: ${seg.regionHint}`)
  wozLog('wizard-injected-prepared', { segId: seg.id, label: seg.label })
}

// ── Controls ──
const resetParticipantAi = () => { sendWizardCommand({ type: 'reset-ai' }); lastAiRequest.value = null; stagedTumors.value = []; addLog('Reset AI', 'Cleared all'); wozLog('wizard-reset-ai') }

const requestTaskRating = () => {
  sendWizardCommand({ type: 'show-task-rating' })
  addLog('Rating popup', 'Prompt sent to participant')
}

const downloadLog = () => {
  const blob = new Blob([exportWozLog()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `woz-log-${new Date().toISOString().slice(0, 16)}.json`; a.click(); URL.revokeObjectURL(url)
}

const isWaiting = computed(() => lastAiRequest.value !== null && participantState.value.aiState === 'running')

const dragPreviewRadius = computed(() => {
  const t = canvasTransform.value; if (!t) return 20; const dpr = window.devicePixelRatio || 1
  return Math.max(8, (selectedSize.value.radius / t.sourceW) * t.drawW / dpr)
})
</script>

<template>
  <div class="h-screen w-screen bg-gray-950 text-gray-200 flex flex-col overflow-hidden select-none">
    <!-- Top bar -->
    <header class="bg-gray-900/80 border-b border-gray-800 px-4 py-2 flex items-center justify-between shrink-0 gap-4">
      <div class="flex items-center gap-3">
        <div class="w-2.5 h-2.5 rounded-full" :class="participantState.patientLoaded ? 'bg-green-500 animate-pulse' : 'bg-gray-600'" />
        <span class="text-sm font-bold text-white tracking-wide">WoZ</span>
        <span class="text-[11px] text-gray-500">|</span>
        <span class="text-[11px] font-mono" :class="{
          'text-yellow-400': participantState.aiState === 'running',
          'text-green-400': participantState.aiState === 'success',
          'text-gray-500': participantState.aiState === 'idle',
          'text-red-400': participantState.aiState === 'rejected',
        }">AI: {{ participantState.aiState }}</span>
        <span class="text-[11px] text-gray-500">|</span>
        <span class="text-[11px] text-gray-400 font-mono">{{ participantState.aiMode }}</span>
        <span v-if="participantState.aiState === 'running'" class="text-[11px] text-yellow-400 font-mono">{{ participantState.aiProgress }}%</span>
        <span v-if="volumeFileName" class="text-[11px] text-gray-600">| {{ volumeFileName }}</span>
      </div>

      <!-- Alert badge -->
      <div v-if="isWaiting" class="flex items-center gap-2 bg-yellow-500/20 border border-yellow-500/40 rounded-full px-3 py-1 animate-pulse">
        <div class="w-2 h-2 rounded-full bg-yellow-400" />
        <span class="text-xs font-semibold text-yellow-300">WAITING — place tumors & inject</span>
      </div>

      <div class="flex items-center gap-2">
        <button class="text-[11px] bg-blue-900/60 hover:bg-blue-800 text-blue-200 px-2 py-1 rounded" @click="requestTaskRating">Ask rating</button>
        <button class="text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-400 px-2 py-1 rounded" @click="downloadLog">Export Log</button>
        <button class="text-[11px] bg-red-900/60 hover:bg-red-800 text-red-300 px-2 py-1 rounded" @click="resetParticipantAi">Reset AI</button>
      </div>
    </header>

    <!-- Main content -->
    <div class="flex-1 flex min-h-0">

      <!-- Left panel: Size + Drag + Staged -->
      <div class="w-[200px] shrink-0 border-r border-gray-800 p-3 flex flex-col gap-3 overflow-y-auto">
        <!-- Size presets (vertical stack) -->
        <div>
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Tumor Size</div>
          <div class="space-y-1">
            <button
              v-for="size in sizePresets" :key="size.id"
              class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
              :class="selectedSize.id === size.id ? 'bg-blue-600/20 ring-1 ring-blue-500' : 'bg-gray-800/60 hover:bg-gray-800'"
              @click="selectedSize = size"
            >
              <div class="shrink-0 rounded-full bg-red-500/30 border border-red-500/50" :style="{ width: `${8 + size.radius * 0.5}px`, height: `${8 + size.radius * 0.5}px` }" />
              <div class="min-w-0">
                <div class="text-xs font-bold" :class="selectedSize.id === size.id ? 'text-blue-300' : 'text-gray-300'">{{ size.label }}</div>
                <div class="text-[10px] text-gray-500">{{ size.desc }} (r={{ size.radius }})</div>
              </div>
            </button>
          </div>
        </div>

        <div v-if="activeMirrorView && volume" class="rounded-lg border border-gray-800 bg-gray-900/60 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Center Slice</div>
              <div class="text-[11px] text-gray-300">{{ activeMirrorView }} view</div>
            </div>
            <span class="text-xs font-mono text-blue-300">{{ displaySliceIndex }}</span>
          </div>
          <input
            v-model.number="selectedInsertSlice"
            type="range"
            class="mt-2 w-full accent-blue-500"
            min="0"
            :max="maxInsertSlice"
          />
          <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-500">
            <span>Participant slice: {{ participantState.sliceIndex }}</span>
            <button class="rounded bg-gray-800 px-2 py-1 text-gray-300 hover:bg-gray-700" @click="syncInsertSliceToParticipant">
              Use participant
            </button>
          </div>
        </div>

        <!-- Draggable tumor chip -->
        <div
          draggable="true"
          class="group flex items-center gap-3 p-3 rounded-lg bg-gray-800/80 border-2 border-dashed border-gray-600 hover:border-blue-500 hover:bg-gray-800 cursor-grab active:cursor-grabbing transition-all"
          @dragstart="onDragStart" @dragend="onDragEnd"
        >
          <div class="shrink-0 rounded-full bg-red-500/30 border-2 border-red-500/60" :style="{ width: `${Math.max(24, selectedSize.radius * 0.8)}px`, height: `${Math.max(24, selectedSize.radius * 0.8)}px` }" />
          <div>
            <div class="text-xs text-gray-300 group-hover:text-white font-medium">Drag to place</div>
            <div class="text-[10px] text-gray-600">or click on image</div>
          </div>
        </div>

        <!-- Staged tumors list -->
        <div v-if="stagedTumors.length > 0">
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Staged ({{ stagedTumors.length }})</div>
          <div class="space-y-1 mb-2">
            <div v-for="tumor in stagedTumors" :key="tumor.id" class="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-800/60 group">
              <div class="w-3 h-3 rounded-full shrink-0" :style="{ backgroundColor: tumor.color + '80' }" />
              <div class="flex-1 min-w-0">
                <div class="text-[11px] text-gray-300 truncate">r={{ tumor.radius }}</div>
                <div class="text-[10px] text-gray-600">({{ Math.round(tumor.cx) }},{{ Math.round(tumor.cy) }},{{ Math.round(tumor.cz) }})</div>
              </div>
              <button class="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity" @click="removeStagedTumor(tumor.id)">x</button>
            </div>
          </div>

          <button
            class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg transition-colors text-sm"
            @click="injectAllStaged"
          >
            Inject {{ stagedTumors.length }} tumor{{ stagedTumors.length > 1 ? 's' : '' }}
          </button>
        </div>

        <!-- Prepared segmentations -->
        <div v-if="preparedSegmentations.length > 0" class="mt-1">
          <div class="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Prepared</div>
          <button v-for="seg in preparedSegmentations" :key="seg.id" class="w-full text-left p-2 rounded bg-gray-800 hover:bg-gray-700 transition-colors mb-1" @click="injectFromPrepared(seg)">
            <div class="text-[11px] font-medium text-gray-300">{{ seg.label }}</div>
            <div class="text-[10px] text-gray-600">{{ seg.regionHint }}</div>
          </button>
        </div>

        <div class="flex-1" />

        <!-- Bounding box info -->
        <div v-if="participantState.boundingBox" class="p-2 rounded bg-yellow-900/20 border border-yellow-700/30">
          <div class="text-[10px] text-yellow-400 font-semibold mb-1">Bounding Box</div>
          <div class="text-[10px] text-yellow-300/60 font-mono leading-relaxed">
            {{ participantState.boundingBox.view }} s{{ participantState.boundingBox.slice }}<br/>
            ({{ Math.round(participantState.boundingBox.x1) }},{{ Math.round(participantState.boundingBox.y1) }}) —
            ({{ Math.round(participantState.boundingBox.x2) }},{{ Math.round(participantState.boundingBox.y2) }})
          </div>
        </div>
      </div>

      <!-- Center: Mirror canvas -->
      <div class="flex-1 relative min-w-0" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
        <div v-if="volumeLoading" class="absolute inset-0 flex items-center justify-center">
          <span class="text-gray-500 text-sm">Loading volume data...</span>
        </div>
        <div v-else-if="!volume" class="absolute inset-0 flex items-center justify-center">
          <span class="text-gray-600 text-sm">No volume loaded</span>
        </div>
        <div v-else-if="!activeMirrorView" class="absolute inset-0 flex items-center justify-center px-6 text-center">
          <span class="text-gray-500 text-sm">Participant is in 3D view. Switch them back to axial, coronal, or sagittal to place tumors.</span>
        </div>

        <div class="w-full h-full p-2">
          <canvas ref="mirrorCanvas" class="w-full h-full rounded-lg cursor-crosshair" @click="onCanvasClick" />
        </div>

        <!-- Drag preview circle -->
        <div v-if="isDragging && dragPreviewPos" class="fixed pointer-events-none rounded-full border-2 border-red-400 bg-red-500/20"
          :style="{ width: `${dragPreviewRadius * 2}px`, height: `${dragPreviewRadius * 2}px`, left: `${dragPreviewPos.x - dragPreviewRadius}px`, top: `${dragPreviewPos.y - dragPreviewRadius}px` }" />
      </div>

      <!-- Right panel: Confidence + Log -->
      <div class="w-[260px] shrink-0 border-l border-gray-800 flex flex-col">
        <div class="p-3 space-y-2 border-b border-gray-800">
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Confidence</div>
          <button v-for="preset in confidencePresets" :key="preset.id"
            class="w-full text-left p-2.5 rounded-lg transition-all"
            :class="selectedConfidence.id === preset.id ? 'ring-2 bg-gray-800' : 'bg-gray-900/60 hover:bg-gray-800/80'"
            :style="selectedConfidence.id === preset.id ? `ring-color: ${preset.color}40; border-left: 3px solid ${preset.color}` : 'border-left: 3px solid transparent'"
            @click="selectedConfidence = preset"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-semibold" :style="{ color: preset.color }">{{ preset.label }}</span>
              <span class="text-[11px] font-mono text-gray-400">{{ (preset.value * 100).toFixed(0) }}%</span>
            </div>
            <p class="text-[10px] leading-relaxed text-gray-500">{{ preset.explanation }}</p>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-3">
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Log</div>
          <div v-if="eventLog.length === 0" class="text-[11px] text-gray-700 italic">Waiting...</div>
          <div class="space-y-0.5">
            <div v-for="(entry, i) in eventLog" :key="i" class="flex items-baseline gap-2 text-[11px] py-0.5">
              <span class="text-gray-700 font-mono shrink-0">{{ entry.time }}</span>
              <span class="font-medium" :class="entry.event.includes('Inject') ? 'text-blue-400' : entry.event.includes('Request') ? 'text-yellow-400' : entry.event.includes('Reset') ? 'text-red-400' : 'text-gray-500'">{{ entry.event }}</span>
              <span class="text-gray-600 truncate">{{ entry.detail }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
