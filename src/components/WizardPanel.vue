<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import {
  listenForStatus,
  sendWizardCommand,
  type ParticipantMessage,
  type PreparedSegmentation,
} from '../lib/wizardChannel'
import { makeId } from '../lib/ids'
import { exportWozLog, wozLog } from '../lib/wizardLog'
import { preparedSegmentations } from '../data/wizardSegmentations'
import { loadMedicalFile } from '../lib/medicalLoader'
import { getSliceSize } from '../lib/volume'
import type { AiDetection, AnnotationLayer, AnnotationMark, BoundingBox, ViewType, VolumeData } from '../types/viewer'

// ── Volume data (loaded independently by wizard) ──
const volume = ref<VolumeData | null>(null)
const volumeLoading = ref(false)

const loadVolume = async () => {
  volumeLoading.value = true
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}IMG-0001-00001.dcm`)
    const blob = await response.blob()
    const file = new File([blob], 'IMG-0001-00001.dcm', { type: 'application/dicom' })
    const result = await loadMedicalFile(file)
    volume.value = result.volume
  } catch (e) {
    console.error('Failed to load volume:', e)
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
})

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
  loadVolume()

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
    }
  })
  addLog('Connected', 'Listening for participant')
})

onUnmounted(() => {
  if (cleanup) cleanup()
})

// ── Canvas rendering ──
const mirrorCanvas = ref<HTMLCanvasElement | null>(null)

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const renderMirror = () => {
  const canvas = mirrorCanvas.value
  const vol = volume.value
  if (!canvas || !vol) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const view = participantState.value.activeView as Exclude<ViewType, 'threeD'>
  if (view === 'threeD' as string) return

  const sliceIndex = participantState.value.sliceIndex
  const { width: sw, height: sh } = getSliceSize(view, vol)

  // Size canvas to fit container
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

  // Window-level from participant's render settings or defaults
  const rs = participantState.value.renderSettings
  const wc = rs?.windowCenter ?? 112
  const ww = rs?.windowWidth ?? 220
  const ct = rs?.contrast ?? 1
  const th = rs?.threshold ?? 0
  const inv = rs?.inverted ?? false

  // Render slice to ImageData
  const buffer = new ImageData(sw, sh)
  const data = buffer.data
  const mri = vol.mri
  const vw = vol.width
  const vh = vol.height

  let baseIdx: number
  let strideX: number
  let strideY: number

  if (view === 'axial') {
    baseIdx = sliceIndex * vw * vh
    strideX = 1
    strideY = vw
  } else if (view === 'coronal') {
    baseIdx = sliceIndex * vw
    strideX = 1
    strideY = vw * vh
  } else {
    baseIdx = sliceIndex
    strideX = vw
    strideY = vw * vh
  }

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
      data[pixel] = gray
      data[pixel + 1] = gray
      data[pixel + 2] = gray
      data[pixel + 3] = 255
    }
  }

  // Draw to canvas with scaling
  const scale = Math.min(cw / sw, ch / sh)
  const drawW = sw * scale
  const drawH = sh * scale
  const drawX = (cw - drawW) * 0.5
  const drawY = (ch - drawH) * 0.5

  // Store transform for hit testing
  canvasTransform.value = { drawX, drawY, drawW, drawH, sourceW: sw, sourceH: sh }

  ctx.fillStyle = '#18181b'
  ctx.fillRect(0, 0, cw, ch)

  const offscreen = document.createElement('canvas')
  offscreen.width = sw
  offscreen.height = sh
  offscreen.getContext('2d')!.putImageData(buffer, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(offscreen, drawX, drawY, drawW, drawH)

  // Draw bounding box overlay
  const box = participantState.value.boundingBox
  if (box && box.view === view && box.slice === sliceIndex) {
    const bx1 = drawX + (Math.min(box.x1, box.x2) / sw) * drawW
    const by1 = drawY + (Math.min(box.y1, box.y2) / sh) * drawH
    const bx2 = drawX + (Math.max(box.x1, box.x2) / sw) * drawW
    const by2 = drawY + (Math.max(box.y1, box.y2) / sh) * drawH
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2 * dpr
    ctx.setLineDash([6 * dpr, 4 * dpr])
    ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1)
    ctx.setLineDash([])

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(250, 204, 21, 0.08)'
    ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1)
  }

  // View label
  ctx.font = `bold ${14 * dpr}px system-ui`
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(`${view.toUpperCase()} — slice ${sliceIndex}`, 8 * dpr, 20 * dpr)
}

const canvasTransform = ref<{ drawX: number; drawY: number; drawW: number; drawH: number; sourceW: number; sourceH: number } | null>(null)

// Re-render when participant state or volume changes
watch(
  [() => participantState.value.activeView, () => participantState.value.sliceIndex, () => participantState.value.boundingBox, () => participantState.value.renderSettings, volume],
  () => { nextTick(renderMirror) },
  { deep: true },
)

// Also render on resize
onMounted(() => {
  const ro = new ResizeObserver(() => renderMirror())
  watch(mirrorCanvas, (el) => {
    if (el?.parentElement) ro.observe(el.parentElement)
  }, { immediate: true })
  onUnmounted(() => ro.disconnect())
})

// ── Confidence presets ──
interface ConfidencePreset {
  id: string
  label: string
  value: number
  color: string
  explanation: string
}

const confidencePresets: ConfidencePreset[] = [
  {
    id: 'very-high',
    label: 'Very High',
    value: 0.95,
    color: '#22c55e',
    explanation: 'Strong contrast enhancement with well-defined margins. Consistent shape across adjacent slices. Signal characteristics highly consistent with neoplastic tissue.',
  },
  {
    id: 'high',
    label: 'High',
    value: 0.87,
    color: '#3b82f6',
    explanation: 'Moderate contrast enhancement observed. Mostly well-defined boundaries with minor irregularities. Good slice-to-slice continuity suggests a true finding.',
  },
  {
    id: 'moderate',
    label: 'Moderate',
    value: 0.72,
    color: '#f59e0b',
    explanation: 'Subtle enhancement detected. Some boundary ambiguity — adjacent tissue shows similar intensity. Clinical correlation recommended to confirm finding.',
  },
  {
    id: 'low',
    label: 'Low',
    value: 0.58,
    color: '#ef4444',
    explanation: 'Minimal contrast difference from surrounding tissue. Irregular margins may indicate artifact or normal anatomical variant. Further sequences recommended.',
  },
]

const selectedConfidence = ref<ConfidencePreset>(confidencePresets[0]!)

// ── Tumor size presets ──
interface SizePreset {
  id: string
  label: string
  radius: number
}

const sizePresets: SizePreset[] = [
  { id: 's', label: 'S', radius: 4 },
  { id: 'm', label: 'M', radius: 8 },
  { id: 'l', label: 'L', radius: 13 },
  { id: 'xl', label: 'XL', radius: 20 },
]

const selectedSize = ref<SizePreset>(sizePresets[1]!)

// ── Annotation generation ──
const contourNoise = (theta: number, sliceOffset: number, seed: number): number =>
  Math.sin(theta * 2.3 + seed * 1.7 + sliceOffset * 0.3) * 0.14 +
  Math.sin(theta * 5.1 + seed * 3.2 - sliceOffset * 0.7) * 0.08 +
  Math.cos(theta * 3.7 + seed * 0.9 + sliceOffset * 0.5) * 0.10 +
  Math.sin(theta * 7.9 - seed * 2.1 + sliceOffset * 0.15) * 0.05

const generateContour = (
  cx: number, cy: number, baseRadius: number, sliceOffset: number, seed: number, numPoints = 36,
): Array<{ x: number; y: number }> => {
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i < numPoints; i++) {
    const theta = (i / numPoints) * Math.PI * 2
    const r = baseRadius * (1 + contourNoise(theta, sliceOffset, seed))
    points.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) })
  }
  return points
}

const generateAnnotations = (
  cx: number, cy: number, cz: number, radius: number, vol: VolumeData, seed: number,
): AnnotationMark[] => {
  const marks: AnnotationMark[] = []
  const r = Math.ceil(radius)

  for (let dz = -r; dz <= r; dz++) {
    const z = Math.round(cz) + dz
    if (z < 0 || z >= vol.depth) continue
    const cr = Math.sqrt(Math.max(0, radius * radius - dz * dz))
    if (cr < 1) continue
    marks.push({ view: 'axial', slice: z, x: cx, y: cy, radius: cr, contour: generateContour(cx, cy, cr, dz, seed) })
  }

  for (let dy = -r; dy <= r; dy++) {
    const y = Math.round(cy) + dy
    if (y < 0 || y >= vol.height) continue
    const cr = Math.sqrt(Math.max(0, radius * radius - dy * dy))
    if (cr < 1) continue
    marks.push({ view: 'coronal', slice: y, x: cx, y: cz, radius: cr, contour: generateContour(cx, cz, cr, dy, seed + 100) })
  }

  for (let dx = -r; dx <= r; dx++) {
    const x = Math.round(cx) + dx
    if (x < 0 || x >= vol.width) continue
    const cr = Math.sqrt(Math.max(0, radius * radius - dx * dx))
    if (cr < 1) continue
    marks.push({ view: 'sagittal', slice: x, x: cy, y: cz, radius: cr, contour: generateContour(cy, cz, cr, dx, seed + 200) })
  }

  return marks
}

// ── Drag-and-drop / click to place ──
const nameOptions = ['Tumor Candidate', 'Suspicious Focus', 'Lesion Candidate', 'Enhancing Region']
const detectionColors = ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']

const canvasToSliceCoords = (clientX: number, clientY: number): { sx: number; sy: number } | null => {
  const canvas = mirrorCanvas.value
  const t = canvasTransform.value
  if (!canvas || !t) return null

  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const px = (clientX - rect.left) * dpr
  const py = (clientY - rect.top) * dpr

  const sx = ((px - t.drawX) / t.drawW) * t.sourceW
  const sy = ((py - t.drawY) / t.drawH) * t.sourceH

  if (sx < 0 || sx >= t.sourceW || sy < 0 || sy >= t.sourceH) return null
  return { sx, sy }
}

const injectAtPosition = (sx: number, sy: number) => {
  const vol = volume.value
  if (!vol) return

  const view = participantState.value.activeView as Exclude<ViewType, 'threeD'>
  const sliceIndex = participantState.value.sliceIndex

  // Map 2D slice coords → 3D volume center
  let cx: number, cy: number, cz: number
  if (view === 'axial') {
    cx = sx; cy = sy; cz = sliceIndex
  } else if (view === 'coronal') {
    cx = sx; cy = sliceIndex; cz = sy
  } else {
    cx = sliceIndex; cy = sx; cz = sy
  }

  const radius = selectedSize.value.radius
  const confidence = selectedConfidence.value.value
  const seed = Math.floor(Math.random() * 10000)
  const name = nameOptions[Math.floor(Math.random() * nameOptions.length)]!
  const layerId = makeId('ai')
  const detId = makeId('det')
  const color = detectionColors[Math.floor(Math.random() * detectionColors.length)]!

  const annotations = generateAnnotations(cx, cy, cz, radius, vol, seed)

  const layer: AnnotationLayer = {
    id: layerId,
    name,
    type: 'ai',
    visible: true,
    color,
    annotations,
  }

  const detection: AiDetection = {
    id: detId,
    name,
    label: 'Tumor',
    confidence,
    centerX: cx,
    centerY: cy,
    centerZ: cz,
    radius,
    status: 'pending',
    layerId,
    color,
  }

  sendWizardCommand({ type: 'inject-detection', layer, detection })
  addLog('Injected', `${selectedConfidence.value.label} conf. at (${Math.round(cx)},${Math.round(cy)},${Math.round(cz)}) r=${radius}`)
  wozLog('wizard-injected', { cx, cy, cz, radius, confidence })
}

// Drag state
const isDragging = ref(false)
const dragPreviewPos = ref<{ x: number; y: number } | null>(null)

const onDragStart = (e: DragEvent) => {
  isDragging.value = true
  // Use a transparent 1x1 image as drag preview (we'll draw our own cursor)
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs='
  e.dataTransfer?.setDragImage(img, 0, 0)
  e.dataTransfer!.effectAllowed = 'copy'
}

const onDragOver = (e: DragEvent) => {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
  dragPreviewPos.value = { x: e.clientX, y: e.clientY }
}

const onDragLeave = () => {
  dragPreviewPos.value = null
}

const onDrop = (e: DragEvent) => {
  e.preventDefault()
  isDragging.value = false
  dragPreviewPos.value = null

  const coords = canvasToSliceCoords(e.clientX, e.clientY)
  if (coords) {
    injectAtPosition(coords.sx, coords.sy)
  }
}

const onDragEnd = () => {
  isDragging.value = false
  dragPreviewPos.value = null
}

// Click-to-place as fallback
const onCanvasClick = (e: MouseEvent) => {
  const coords = canvasToSliceCoords(e.clientX, e.clientY)
  if (coords) {
    injectAtPosition(coords.sx, coords.sy)
  }
}

// ── Prepared segmentations ──
const injectFromPrepared = (seg: PreparedSegmentation) => {
  const layerId = makeId('ai')
  const detId = makeId('det')
  const color = detectionColors[Math.floor(Math.random() * detectionColors.length)]!

  const layer: AnnotationLayer = {
    id: layerId,
    name: seg.name,
    type: 'ai',
    visible: true,
    color,
    annotations: seg.annotations,
  }

  const detection: AiDetection = {
    id: detId,
    name: seg.name,
    label: seg.label,
    confidence: seg.confidence,
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
const resetParticipantAi = () => {
  sendWizardCommand({ type: 'reset-ai' })
  lastAiRequest.value = null
  addLog('Reset AI', 'Cleared participant detections')
  wozLog('wizard-reset-ai')
}

const downloadLog = () => {
  const blob = new Blob([exportWozLog()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `woz-log-${new Date().toISOString().slice(0, 16)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const isWaiting = computed(() => lastAiRequest.value !== null && participantState.value.aiState === 'running')

// ── Drag preview circle radius in CSS px ──
const dragPreviewRadius = computed(() => {
  const t = canvasTransform.value
  if (!t) return 20
  const dpr = window.devicePixelRatio || 1
  return Math.max(8, (selectedSize.value.radius / t.sourceW) * t.drawW / dpr)
})
</script>

<template>
  <div class="h-screen w-screen bg-gray-950 text-gray-200 flex flex-col overflow-hidden select-none">
    <!-- ── Top bar ── -->
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
      </div>

      <!-- Alert badge -->
      <div
        v-if="isWaiting"
        class="flex items-center gap-2 bg-yellow-500/20 border border-yellow-500/40 rounded-full px-3 py-1 animate-pulse"
      >
        <div class="w-2 h-2 rounded-full bg-yellow-400" />
        <span class="text-xs font-semibold text-yellow-300">WAITING — click image to inject</span>
      </div>

      <div class="flex items-center gap-2">
        <button class="text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-400 px-2 py-1 rounded" @click="downloadLog">Export Log</button>
        <button class="text-[11px] bg-red-900/60 hover:bg-red-800 text-red-300 px-2 py-1 rounded" @click="resetParticipantAi">Reset AI</button>
      </div>
    </header>

    <!-- ── Main content ── -->
    <div class="flex-1 flex min-h-0">

      <!-- Left panel: Tumor presets (draggable) -->
      <div class="w-[180px] shrink-0 border-r border-gray-800 p-3 flex flex-col gap-3">
        <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Drag tumor</div>

        <!-- Size presets -->
        <div class="space-y-1.5">
          <div class="text-[10px] text-gray-600 uppercase tracking-wider">Size</div>
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="size in sizePresets"
              :key="size.id"
              class="relative flex items-center justify-center py-1.5 rounded text-xs font-bold transition-all"
              :class="selectedSize.id === size.id
                ? 'bg-blue-600 text-white ring-1 ring-blue-400'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'"
              @click="selectedSize = size"
            >
              {{ size.label }}
            </button>
          </div>
        </div>

        <!-- Draggable tumor chip -->
        <div
          draggable="true"
          class="group flex flex-col items-center gap-2 p-3 rounded-lg bg-gray-800/80 border-2 border-dashed border-gray-600 hover:border-blue-500 hover:bg-gray-800 cursor-grab active:cursor-grabbing transition-all"
          @dragstart="onDragStart"
          @dragend="onDragEnd"
        >
          <div class="relative">
            <div
              class="rounded-full bg-red-500/30 border-2 border-red-500/60 transition-all"
              :style="{ width: `${Math.max(20, selectedSize.radius * 2.5)}px`, height: `${Math.max(20, selectedSize.radius * 2.5)}px` }"
            />
          </div>
          <span class="text-[11px] text-gray-400 group-hover:text-gray-200">
            r={{ selectedSize.radius }}px
          </span>
          <span class="text-[10px] text-gray-600">drag onto image</span>
        </div>

        <!-- Prepared segmentations -->
        <div v-if="preparedSegmentations.length > 0" class="space-y-1.5 mt-2">
          <div class="text-[10px] text-gray-600 uppercase tracking-wider">Prepared</div>
          <button
            v-for="seg in preparedSegmentations"
            :key="seg.id"
            class="w-full text-left p-2 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
            @click="injectFromPrepared(seg)"
          >
            <div class="text-[11px] font-medium text-gray-300">{{ seg.label }}</div>
            <div class="text-[10px] text-gray-600">{{ seg.regionHint }}</div>
          </button>
        </div>

        <!-- Spacer -->
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
      <div
        class="flex-1 relative min-w-0"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div v-if="volumeLoading" class="absolute inset-0 flex items-center justify-center">
          <span class="text-gray-500 text-sm">Loading volume data...</span>
        </div>
        <div v-else-if="!volume" class="absolute inset-0 flex items-center justify-center">
          <span class="text-gray-600 text-sm">No volume loaded</span>
        </div>

        <div class="w-full h-full p-2">
          <canvas
            ref="mirrorCanvas"
            class="w-full h-full rounded-lg cursor-crosshair"
            @click="onCanvasClick"
          />
        </div>

        <!-- Drag preview circle -->
        <div
          v-if="isDragging && dragPreviewPos"
          class="fixed pointer-events-none rounded-full border-2 border-red-400 bg-red-500/20"
          :style="{
            width: `${dragPreviewRadius * 2}px`,
            height: `${dragPreviewRadius * 2}px`,
            left: `${dragPreviewPos.x - dragPreviewRadius}px`,
            top: `${dragPreviewPos.y - dragPreviewRadius}px`,
          }"
        />
      </div>

      <!-- Right panel: Confidence + Log -->
      <div class="w-[260px] shrink-0 border-l border-gray-800 flex flex-col">
        <!-- Confidence presets -->
        <div class="p-3 space-y-2 border-b border-gray-800">
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Confidence</div>

          <button
            v-for="preset in confidencePresets"
            :key="preset.id"
            class="w-full text-left p-2.5 rounded-lg transition-all"
            :class="selectedConfidence.id === preset.id
              ? 'ring-2 bg-gray-800'
              : 'bg-gray-900/60 hover:bg-gray-800/80'"
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

        <!-- Event log -->
        <div class="flex-1 overflow-y-auto p-3">
          <div class="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Log</div>
          <div v-if="eventLog.length === 0" class="text-[11px] text-gray-700 italic">Waiting...</div>
          <div class="space-y-0.5">
            <div
              v-for="(entry, i) in eventLog"
              :key="i"
              class="flex items-baseline gap-2 text-[11px] py-0.5"
            >
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
