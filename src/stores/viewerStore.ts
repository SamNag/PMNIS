import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { mockPatient } from '../data/mockPatient'
import { makeId } from '../lib/ids'
import { defaultLayerColors } from '../lib/layerColors'
import { loadMedicalFile } from '../lib/medicalLoader'
import { slicePointToVolume } from '../lib/annotations'
import { getDefaultSliceForView, getViewMaxSlice } from '../lib/volume'
import {
  listenForCommands,
  sendParticipantMessage,
  uploadVolumeForWizard,
  type WizardCommand,
} from '../lib/wizardChannel'
import { wozLog } from '../lib/wizardLog'
import type {
  AiDetection,
  AiMode,
  AiState,
  AnnotationLayer,
  AnnotationMark,
  BoundingBox,
  LayoutMode,
  RenderSettings,
  ToolId,
  ToolbarSection,
  ViewType,
  ViewportState,
  VolumeData,
} from '../types/viewer'

const manualTools: ToolId[] = ['brush', 'eraser']
const instantTools: ToolId[] = ['fit', 'reset', 'invert', 'clearSelection']
const MAX_HISTORY_SIZE = 80
const TRI_PLANAR_LAYOUT_ORDER: Array<Exclude<ViewType, 'threeD'>> = ['axial', 'coronal', 'sagittal']

const colors = defaultLayerColors
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const cloneAnnotations = (marks: AnnotationMark[]): AnnotationMark[] => marks.map((mark) => ({ ...mark }))
const detectionColors = ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']
const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min)
const randomInt = (min: number, max: number): number => Math.round(randomBetween(min, max))

/** Deterministic organic noise for contour deformation. */
const contourNoise = (theta: number, sliceOffset: number, seed: number): number =>
  Math.sin(theta * 2.3 + seed * 1.7 + sliceOffset * 0.3) * 0.14 +
  Math.sin(theta * 5.1 + seed * 3.2 - sliceOffset * 0.7) * 0.08 +
  Math.cos(theta * 3.7 + seed * 0.9 + sliceOffset * 0.5) * 0.10 +
  Math.sin(theta * 7.9 - seed * 2.1 + sliceOffset * 0.15) * 0.05

/** Generate an irregular closed polygon contour around a center point. */
const generateContour = (
  cx: number,
  cy: number,
  baseRadius: number,
  sliceOffset: number,
  seed: number,
  numPoints = 36,
): Array<{ x: number; y: number }> => {
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i < numPoints; i++) {
    const theta = (i / numPoints) * Math.PI * 2
    const r = baseRadius * (1 + contourNoise(theta, sliceOffset, seed))
    points.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) })
  }
  return points
}

/** Build contour-based annotations for an irregular 3-D detection region. */
const generateIrregularAnnotations = (
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  volume: VolumeData,
  seed: number,
): AnnotationMark[] => {
  const marks: AnnotationMark[] = []
  const r = Math.ceil(radius)

  // Axial slices (z-axis)
  for (let dz = -r; dz <= r; dz++) {
    const z = Math.round(cz) + dz
    if (z < 0 || z >= volume.depth) continue
    const cr = Math.sqrt(Math.max(0, radius * radius - dz * dz))
    if (cr < 1) continue
    const contour = generateContour(cx, cy, cr, dz, seed)
    marks.push({ view: 'axial', slice: z, x: cx, y: cy, radius: cr, contour })
  }

  // Coronal slices (y-axis)
  for (let dy = -r; dy <= r; dy++) {
    const y = Math.round(cy) + dy
    if (y < 0 || y >= volume.height) continue
    const cr = Math.sqrt(Math.max(0, radius * radius - dy * dy))
    if (cr < 1) continue
    const contour = generateContour(cx, cz, cr, dy, seed + 100)
    marks.push({ view: 'coronal', slice: y, x: cx, y: cz, radius: cr, contour })
  }

  // Sagittal slices (x-axis)
  for (let dx = -r; dx <= r; dx++) {
    const x = Math.round(cx) + dx
    if (x < 0 || x >= volume.width) continue
    const cr = Math.sqrt(Math.max(0, radius * radius - dx * dx))
    if (cr < 1) continue
    const contour = generateContour(cy, cz, cr, dx, seed + 200)
    marks.push({ view: 'sagittal', slice: x, x: cy, y: cz, radius: cr, contour })
  }

  return marks
}

const defaultRenderSettings = (): RenderSettings => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  windowCenter: 112,
  windowWidth: 220,
  contrast: 1,
  threshold: 0,
  inverted: false,
})

const defaultViewports = (): ViewportState[] => [
  ...TRI_PLANAR_LAYOUT_ORDER.map((view, index) => ({
    id: `vp-${index + 1}`,
    label: `Viewport ${index + 1}`,
    assignedView: view,
    sliceIndex: 0,
  })),
  { id: 'vp-4', label: 'Viewport 4', assignedView: 'threeD', sliceIndex: 0 },
]

export const useViewerStore = defineStore('viewer', () => {
  const currentPatient = ref<typeof mockPatient | null>(null)
  const volumeData = ref<VolumeData | null>(null)

  const isPatientLoaded = ref(false)
  const mriLoaded = ref(false)
  const tumorMaskLoaded = ref(false)

  const layout = ref<LayoutMode>('3x1')
  const activeViewportId = ref('vp-1')
  const viewports = ref<ViewportState[]>(defaultViewports())
  const isFullscreenMode = ref(false)

  const activeTool = ref<ToolId>('zoom')
  const activeToolbarSection = ref<ToolbarSection>('image')

  const renderSettings = ref<RenderSettings>(defaultRenderSettings())
  const brushSize = ref(2.5)
  const showTumorMask = ref(true)

  const annotationLayers = ref<AnnotationLayer[]>([])
  const activeLayerId = ref<string | null>(null)
  const manualHistory = ref<Record<string, AnnotationMark[][]>>({})
  const manualFuture = ref<Record<string, AnnotationMark[][]>>({})
  /** Shallow counter bumped whenever annotations change, to avoid deep-watching annotationLayers. */
  const annotationVersion = ref(0)
  /** Lightweight counter for in-progress strokes so other viewports can redraw live. */
  const annotationPreviewVersion = ref(0)

  const aiMode = ref<AiMode>('full')
  const aiState = ref<AiState>('idle')
  const aiProgress = ref(0)
  const aiDetections = ref<AiDetection[]>([])
  const selectedDetectionId = ref<string | null>(null)
  const editingDetectionId = ref<string | null>(null)
  const taskRatingQuestion = ref('How easy was this task?')
  const taskRatingVisible = ref(false)
  const selectedTaskRating = ref<number | null>(null)
  /** Mode that was active when AI was last run (controls whether editing is allowed). */
  const aiRunMode = ref<AiMode | null>(null)
  /** Bounding box drawn by user for semi-auto AI mode. */
  const aiBoundingBox = ref<BoundingBox | null>(null)

  // ── Wizard-of-Oz state ──
  const wozEnabled = ref(false)
  const wozWaitingForWizard = ref(false)
  let wozResolve: ((cmd: WizardCommand) => void) | null = null
  let wozCleanup: (() => void) | null = null

  /** Activate WoZ mode – participant listens for wizard commands via SSE. */
  const enableWoz = () => {
    if (wozEnabled.value) return
    wozEnabled.value = true
    wozCleanup = listenForCommands((cmd) => {
      if (cmd.type === 'inject-detection') {
        // Always inject the detection into the store
        annotationLayers.value.unshift(cmd.layer)
        aiDetections.value = [...aiDetections.value, cmd.detection]
        if (aiDetections.value.length === 1) {
          selectDetection(cmd.detection.id)
        }
        annotationVersion.value++

        // If runAi is waiting, resolve it to complete the progress bar
        if (wozResolve) {
          wozResolve(cmd)
          wozResolve = null
          wozWaitingForWizard.value = false
        }
      } else if (cmd.type === 'set-progress') {
        aiProgress.value = cmd.value
      } else if (cmd.type === 'complete-progress') {
        aiProgress.value = 100
      } else if (cmd.type === 'reset-ai') {
        aiDetections.value = []
        annotationLayers.value = annotationLayers.value.filter((l) => l.type !== 'ai')
        selectedDetectionId.value = null
        editingDetectionId.value = null
        aiRunMode.value = null
        aiState.value = 'idle'
        aiProgress.value = 0
        aiBoundingBox.value = null
        wozWaitingForWizard.value = false
        wozResolve = null
        annotationVersion.value++
      } else if (cmd.type === 'show-task-rating') {
        taskRatingQuestion.value = cmd.question?.trim() || 'How easy was this task?'
        selectedTaskRating.value = null
        taskRatingVisible.value = true
      }
    })
  }

  const disableWoz = () => {
    wozEnabled.value = false
    wozWaitingForWizard.value = false
    wozResolve = null
    if (wozCleanup) {
      wozCleanup()
      wozCleanup = null
    }
  }
  const activeViewport = computed<ViewportState | null>(
    () => viewports.value.find((viewport) => viewport.id === activeViewportId.value) ?? viewports.value[0] ?? null,
  )

  const activeLayer = computed(() => {
    for (const layer of annotationLayers.value) {
      if (layer.id === activeLayerId.value) return layer
      if (layer.children) {
        const child = layer.children.find((c) => c.id === activeLayerId.value)
        if (child) return child
      }
    }
    return null
  })

  const selectedLayerHasSelection = computed(() => (activeLayer.value?.annotations.length ?? 0) > 0)

  const visibleViewports = computed(() => {
    if (layout.value === '3x1') return viewports.value.slice(0, 3)
    return activeViewport.value ? [activeViewport.value] : []
  })

  const normalizeTriPlanarViewports = () => {
    const viewportByView = new Map<ViewType, ViewportState>()
    for (const viewport of viewports.value) {
      if (!viewportByView.has(viewport.assignedView)) {
        viewportByView.set(viewport.assignedView, viewport)
      }
    }

    TRI_PLANAR_LAYOUT_ORDER.forEach((view, index) => {
      const viewport = viewports.value[index]
      if (!viewport) return

      viewport.assignedView = view
      viewport.sliceIndex = viewportByView.get(view)?.sliceIndex ?? (
        volumeData.value ? getDefaultSliceForView(view, volumeData.value) : viewport.sliceIndex
      )
    })
  }

  const isLayerEditable = (layer: AnnotationLayer): boolean => {
    if (layer.type === 'manual') return true
    if (layer.type === 'folder') return false // Folder itself is not editable, children are
    if (layer.type === 'ai' && editingDetectionId.value) {
      const detection = aiDetections.value.find((d) => d.id === editingDetectionId.value)
      return !!detection && detection.layerId === layer.id && detection.status !== 'rejected'
    }
    return false
  }

  const canAnnotate = computed(() => {
    if (!isPatientLoaded.value || !manualTools.includes(activeTool.value) || !activeLayer.value) return false
    return isLayerEditable(activeLayer.value)
  })

  const canRunAi = computed(() => {
    if (!isPatientLoaded.value || aiState.value === 'running') return false
    if (aiMode.value === 'semi' && !aiBoundingBox.value) return false
    return true
  })

  const canUndoManual = computed(() => {
    const layer = activeLayer.value
    if (!layer || !isLayerEditable(layer)) return false
    return (manualHistory.value[layer.id]?.length ?? 0) > 0
  })

  const canRedoManual = computed(() => {
    const layer = activeLayer.value
    if (!layer || !isLayerEditable(layer)) return false
    return (manualFuture.value[layer.id]?.length ?? 0) > 0
  })

  const getNextLayerColor = (): string => colors[annotationLayers.value.length % colors.length] ?? '#0ea5e9'
  const getRenderableLayerCount = (): number =>
    annotationLayers.value.reduce((count, layer) => count + (layer.type === 'folder' ? layer.children?.length ?? 0 : 1), 0)
  const getNextLayerName = (): string => `Tumor ${getRenderableLayerCount() + 1}`

  const getManualHistoryBucket = (layerId: string): AnnotationMark[][] => {
    const bucket = manualHistory.value[layerId]
    if (bucket) return bucket
    const next: AnnotationMark[][] = []
    manualHistory.value[layerId] = next
    return next
  }

  const getManualFutureBucket = (layerId: string): AnnotationMark[][] => {
    const bucket = manualFuture.value[layerId]
    if (bucket) return bucket
    const next: AnnotationMark[][] = []
    manualFuture.value[layerId] = next
    return next
  }

  const pushManualHistorySnapshot = (layer: AnnotationLayer) => {
    if (!isLayerEditable(layer)) return
    const history = getManualHistoryBucket(layer.id)
    history.push(cloneAnnotations(layer.annotations))
    if (history.length > MAX_HISTORY_SIZE) {
      history.shift()
    }
    manualFuture.value[layer.id] = []
  }

  const getTodayDate = (): string => new Date().toISOString().split('T')[0] || ''

  const stripUploadedFileExtension = (fileName: string): string =>
    fileName.replace(/\.(nii(\.gz)?|dcm|dicom)$/i, '')

  const initializeLoadedStudy = (
    volume: VolumeData,
    patient: typeof mockPatient,
    options: { tumorMaskLoaded: boolean; showTumorMask: boolean },
  ) => {
    volumeData.value = volume
    currentPatient.value = patient

    isPatientLoaded.value = true
    mriLoaded.value = true
    tumorMaskLoaded.value = options.tumorMaskLoaded
    showTumorMask.value = options.showTumorMask

    renderSettings.value = defaultRenderSettings()
    annotationLayers.value = []
    activeLayerId.value = null
    manualHistory.value = {}
    manualFuture.value = {}
    aiState.value = 'idle'
    aiProgress.value = 0
    annotationPreviewVersion.value = 0
    brushSize.value = 2.5
    aiDetections.value = []
    selectedDetectionId.value = null
    editingDetectionId.value = null
    taskRatingQuestion.value = 'How easy was this task?'
    taskRatingVisible.value = false
    selectedTaskRating.value = null
    aiRunMode.value = null
    aiBoundingBox.value = null
    activeToolbarSection.value = 'image'
    activeTool.value = 'zoom'

    viewports.value = defaultViewports().map((viewport) => {
      if (viewport.assignedView === 'threeD') {
        return { ...viewport, sliceIndex: 0 }
      }

      return {
        ...viewport,
        sliceIndex: getDefaultSliceForView(viewport.assignedView, volume),
      }
    })
    activeViewportId.value = 'vp-1'
  }

  const loadPatient = async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}BraTS20_Training_002_t1ce.nii`)
    const blob = await response.blob()
    const file = new File([blob], 'BraTS20_Training_002_t1ce.nii', { type: 'application/octet-stream' })
    const { volume, metadata } = await loadMedicalFile(file)

    initializeLoadedStudy(
      volume,
      {
        id: mockPatient.id,
        name: metadata.patientName || mockPatient.name,
        age: metadata.age ?? mockPatient.age,
        scanDate: metadata.scanDate ?? mockPatient.scanDate,
        studyType: metadata.studyType ?? mockPatient.studyType,
      },
      { tumorMaskLoaded: false, showTumorMask: false },
    )

    if (wozEnabled.value) uploadVolumeForWizard(file).catch(() => {})
  }

  const loadStudentDemo = async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}BraTS20_Training_002_t1ce.nii`)
    const blob = await response.blob()
    const file = new File([blob], 'BraTS20_Training_002_t1ce.nii', { type: 'application/octet-stream' })
    const { volume, metadata } = await loadMedicalFile(file)

    initializeLoadedStudy(
      volume,
      {
        id: mockPatient.id,
        name: metadata.patientName || mockPatient.name,
        age: metadata.age ?? mockPatient.age,
        scanDate: metadata.scanDate ?? mockPatient.scanDate,
        studyType: metadata.studyType ?? mockPatient.studyType,
      },
      { tumorMaskLoaded: false, showTumorMask: false },
    )

    // Create a pre-built tumor annotation layer so students see the finding immediately.
    // Annotations need contour polygons to be visible in the 2D renderer.
    // Use depth-aware sizing: nice circle in axial, small dot in coronal/sagittal.
    const vol = volume
    const cx = vol.width * 0.45
    const cy = vol.height * 0.42
    const cz = vol.depth * 0.48
    const axialR = Math.max(6, Math.min(vol.width, vol.height) * 0.04)
    const crossR = Math.min(axialR, Math.max(2, vol.depth * 0.15))
    const layerId = makeId('manual')
    const color = '#ef4444'
    const seed = 42

    const annotations: AnnotationMark[] = []

    // Axial marks — spread across a few z-slices, with contour polygons
    const zSpread = Math.max(2, Math.round(vol.depth * 0.12))
    for (let dz = -zSpread; dz <= zSpread; dz++) {
      const z = Math.round(cz) + dz
      if (z < 0 || z >= vol.depth) continue
      const t = Math.max(0, 1 - (dz * dz) / (zSpread * zSpread))
      const r = axialR * Math.sqrt(t)
      if (r < 1) continue
      const contour = generateContour(cx, cy, r, dz, seed)
      annotations.push({ view: 'axial', slice: z, x: cx, y: cy, radius: r, contour })
    }

    // Coronal marks — small radius capped to depth
    const ySpread = Math.round(axialR * 0.6)
    for (let dy = -ySpread; dy <= ySpread; dy++) {
      const y = Math.round(cy) + dy
      if (y < 0 || y >= vol.height) continue
      const t = Math.max(0, 1 - (dy * dy) / (ySpread * ySpread))
      const r = crossR * Math.sqrt(t)
      if (r < 1) continue
      const contour = generateContour(cx, cz, r, dy, seed + 100)
      annotations.push({ view: 'coronal', slice: y, x: cx, y: cz, radius: r, contour })
    }

    // Sagittal marks — same small radius
    const xSpread = Math.round(axialR * 0.6)
    for (let dx = -xSpread; dx <= xSpread; dx++) {
      const x = Math.round(cx) + dx
      if (x < 0 || x >= vol.width) continue
      const t = Math.max(0, 1 - (dx * dx) / (xSpread * xSpread))
      const r = crossR * Math.sqrt(t)
      if (r < 1) continue
      const contour = generateContour(cy, cz, r, dx, seed + 200)
      annotations.push({ view: 'sagittal', slice: x, x: cy, y: cz, radius: r, contour })
    }

    const tumorLayer: AnnotationLayer = {
      id: layerId,
      name: 'Tumor Finding',
      type: 'manual',
      visible: true,
      color,
      annotations,
      timestamp: Date.now(),
    }

    annotationLayers.value.unshift(tumorLayer)
    activeLayerId.value = layerId
    annotationVersion.value++

    // Navigate viewports to the tumor center so students see it immediately
    for (const vp of viewports.value) {
      if (vp.assignedView === 'axial') vp.sliceIndex = Math.round(cz)
      else if (vp.assignedView === 'coronal') vp.sliceIndex = Math.round(cy)
      else if (vp.assignedView === 'sagittal') vp.sliceIndex = Math.round(cx)
    }
  }

  const loadMedicalPatient = async (file: File, patientName?: string) => {
    const { volume, metadata } = await loadMedicalFile(file)

    initializeLoadedStudy(
      volume,
      {
        id: makeId('patient'),
        name: patientName || metadata.patientName || stripUploadedFileExtension(file.name) || file.name,
        age: metadata.age ?? 0,
        scanDate: metadata.scanDate ?? getTodayDate(),
        studyType: metadata.studyType ?? 'MRI',
      },
      { tumorMaskLoaded: false, showTumorMask: false },
    )

    if (wozEnabled.value) uploadVolumeForWizard(file).catch(() => {})
  }

  const setLayout = (next: LayoutMode) => {
    layout.value = next
    if (next === '3x1') {
      normalizeTriPlanarViewports()
      if (!viewports.value.slice(0, 3).some((viewport) => viewport.id === activeViewportId.value)) {
        activeViewportId.value = viewports.value[0]?.id ?? activeViewportId.value
      }
    }
  }

  const toggleFullscreenMode = (viewportId?: string) => {
    if (viewportId) {
      activeViewportId.value = viewportId
    }
    isFullscreenMode.value = !isFullscreenMode.value
  }

  const setActiveViewport = (viewportId: string) => {
    activeViewportId.value = viewportId
  }

  const assignViewToActiveViewport = (view: ViewType) => {
    const viewport = activeViewport.value
    if (!viewport) return
    viewport.assignedView = view
    if (volumeData.value) {
      viewport.sliceIndex = getDefaultSliceForView(view, volumeData.value)
    }
  }

  const assignViewToViewport = (viewportId: string, view: ViewType) => {
    const viewport = viewports.value.find((entry) => entry.id === viewportId)
    if (!viewport) return
    viewport.assignedView = view
    if (volumeData.value) {
      viewport.sliceIndex = getDefaultSliceForView(view, volumeData.value)
    }
  }

  const updateSlice = (viewportId: string, delta: number) => {
    const viewport = viewports.value.find((entry) => entry.id === viewportId)
    if (!viewport || !volumeData.value) return

    const maxSlice = getViewMaxSlice(viewport.assignedView, volumeData.value)
    viewport.sliceIndex = Math.max(0, Math.min(maxSlice, viewport.sliceIndex + delta))
  }

  const setSlice = (viewportId: string, value: number) => {
    const viewport = viewports.value.find((entry) => entry.id === viewportId)
    if (!viewport || !volumeData.value) return

    const maxSlice = getViewMaxSlice(viewport.assignedView, volumeData.value)
    viewport.sliceIndex = Math.max(0, Math.min(maxSlice, value))
  }

  const setActiveTool = (tool: ToolId, section: ToolbarSection) => {
    if (section !== 'general') { // Ensure general controls remain consistent
      activeToolbarSection.value = section;
    }

    if (!instantTools.includes(tool)) {
      activeTool.value = tool
    }

    if (tool === 'fit') {
      renderSettings.value.zoom = 1
      renderSettings.value.panX = 0
      renderSettings.value.panY = 0
    }

    if (tool === 'reset') {
      renderSettings.value = defaultRenderSettings()
    }

    if (tool === 'invert') {
      renderSettings.value.inverted = !renderSettings.value.inverted
    }

    if (tool === 'clearSelection' && activeLayer.value) {
      pushManualHistorySnapshot(activeLayer.value)
      activeLayer.value.annotations = []
      annotationVersion.value++
    }
  }

  const setActiveToolbarSection = (section: ToolbarSection) => {
    if (section !== 'general') { // Prevent changing general controls
      activeToolbarSection.value = section
    }
  }

  const updateWindowWidth = (delta: number) => {
    renderSettings.value.windowWidth = clamp(renderSettings.value.windowWidth + delta, 40, 480)
  }


  const updateWindowCenter = (delta: number) => {
    renderSettings.value.windowCenter = clamp(renderSettings.value.windowCenter + delta, 20, 220)
  }

  const updateZoom = (delta: number) => {
    renderSettings.value.zoom = clamp(renderSettings.value.zoom + delta, 0.4, 2.8)
  }

  const setWindowCenter = (value: number) => {
    renderSettings.value.windowCenter = clamp(value, 20, 220)
  }

  const setWindowWidth = (value: number) => {
    renderSettings.value.windowWidth = clamp(value, 40, 480)
  }

  const setContrast = (value: number) => {
    renderSettings.value.contrast = clamp(value, 0.4, 2.4)
  }

  const setThreshold = (value: number) => {
    renderSettings.value.threshold = clamp(value, 0, 255)
  }

  const setBrushSize = (value: number) => {
    const normalized = Math.round((Number.isFinite(value) ? value : brushSize.value) * 10) / 10
    brushSize.value = clamp(normalized, 0.5, 14)
  }

  const createManualLayer = () => {
    const layerId = makeId('layer')
    const color = getNextLayerColor()

    const layer: AnnotationLayer = {
      id: layerId,
      name: getNextLayerName(),
      type: 'manual',
      visible: true,
      color,
      annotations: [],
    }

    annotationLayers.value.unshift(layer)
    activeLayerId.value = layerId
    getManualHistoryBucket(layerId)
    getManualFutureBucket(layerId)
  }

  /** Find a layer by id, searching also in folder children. */
  const findLayerById = (layerId: string): AnnotationLayer | null => {
    for (const layer of annotationLayers.value) {
      if (layer.id === layerId) return layer
      if (layer.children) {
        const child = layer.children.find((c) => c.id === layerId)
        if (child) return child
      }
    }
    return null
  }

  const setActiveLayer = (layerId: string) => {
    activeLayerId.value = layerId
  }

  const toggleFolderExpanded = (folderId: string) => {
    const folder = annotationLayers.value.find((l) => l.id === folderId)
    if (folder && folder.type === 'folder') {
      folder.expanded = !folder.expanded
    }
  }

  const toggleLayerVisibility = (layerId: string) => {
    const layer = findLayerById(layerId)
    if (!layer) return
    layer.visible = !layer.visible
    // For folders, toggle all children too
    if (layer.type === 'folder' && layer.children) {
      for (const child of layer.children) {
        child.visible = layer.visible
      }
    }
    annotationVersion.value++
  }

  const renameLayer = (layerId: string, nextName: string) => {
    const layer = findLayerById(layerId)
    const trimmed = nextName.trim()
    if (!layer || !trimmed) return
    layer.name = trimmed

    const detection = aiDetections.value.find((item) => item.layerId === layerId)
    if (detection) {
      detection.name = trimmed
    }
  }

  const setLayerColor = (layerId: string, nextColor: string) => {
    const layer = findLayerById(layerId)
    if (!layer || !nextColor) return
    layer.color = nextColor

    const detection = aiDetections.value.find((item) => item.layerId === layerId)
    if (detection) {
      detection.color = nextColor
    }

    annotationVersion.value++
  }

  const deleteLayer = (layerId: string) => {
    let parentFolderIdToRemove: string | null = null

    // Check if it's a top-level layer (including folder)
    const topLevel = annotationLayers.value.find((l) => l.id === layerId)
    if (topLevel) {
      // Clean up children history if folder
      if (topLevel.children) {
        for (const child of topLevel.children) {
          delete manualHistory.value[child.id]
          delete manualFuture.value[child.id]
        }
      }
      annotationLayers.value = annotationLayers.value.filter((layer) => layer.id !== layerId)
      delete manualHistory.value[layerId]
      delete manualFuture.value[layerId]
    } else {
      // Check if it's a child inside a folder
      for (const folder of annotationLayers.value) {
        if (folder.children) {
          const idx = folder.children.findIndex((c) => c.id === layerId)
          if (idx >= 0) {
            folder.children.splice(idx, 1)
            if (folder.children.length === 0) {
              parentFolderIdToRemove = folder.id
            }
            delete manualHistory.value[layerId]
            delete manualFuture.value[layerId]
            break
          }
        }
      }
    }

    if (parentFolderIdToRemove) {
      annotationLayers.value = annotationLayers.value.filter((layer) => layer.id !== parentFolderIdToRemove)
    }

    if (activeLayerId.value === layerId) {
      // Find next available layer
      const first = annotationLayers.value[0]
      activeLayerId.value = (first?.children?.[0]?.id ?? first?.id) ?? null
    }
    annotationVersion.value++
  }

  /** Add a new finding child to an existing folder. */
  const addFindingToFolder = (folderId: string) => {
    const folder = annotationLayers.value.find((l) => l.id === folderId && l.type === 'folder')
    if (!folder || !folder.children) return

    const childId = makeId('layer')
    const color = getNextLayerColor()
    const child: AnnotationLayer = {
      id: childId,
      name: `Finding ${folder.children.length + 1}`,
      type: 'manual',
      visible: true,
      color,
      annotations: [],
    }

    folder.children.push(child)
    folder.expanded = true
    activeLayerId.value = childId
    getManualHistoryBucket(childId)
    getManualFutureBucket(childId)
  }

  const beginManualEdit = () => {
    const layer = activeLayer.value
    if (!layer || !isLayerEditable(layer)) return
    pushManualHistorySnapshot(layer)
  }

  const endManualEdit = () => {
    annotationPreviewVersion.value += 1
    annotationVersion.value++
  }

  const undoManualEdit = () => {
    const layer = activeLayer.value
    if (!layer || !isLayerEditable(layer)) return
    const history = getManualHistoryBucket(layer.id)
    const future = getManualFutureBucket(layer.id)
    if (!history.length) return
    future.push(cloneAnnotations(layer.annotations))
    layer.annotations = history.pop() ?? []
    annotationPreviewVersion.value += 1
    annotationVersion.value++
  }

  const redoManualEdit = () => {
    const layer = activeLayer.value
    if (!layer || !isLayerEditable(layer)) return
    const future = getManualFutureBucket(layer.id)
    const history = getManualHistoryBucket(layer.id)
    if (!future.length) return
    history.push(cloneAnnotations(layer.annotations))
    layer.annotations = future.pop() ?? []
    annotationPreviewVersion.value += 1
    annotationVersion.value++
  }

  const resetActiveManualLayer = () => {
    const layer = activeLayer.value
    if (!layer || !isLayerEditable(layer) || !layer.annotations.length) return
    pushManualHistorySnapshot(layer)
    layer.annotations = []
    annotationPreviewVersion.value += 1
    annotationVersion.value++
  }

  const addAnnotation = (
    view: Exclude<ViewType, 'threeD'>,
    slice: number,
    x: number,
    y: number,
    radius: number,
  ) => {
    if (!canAnnotate.value || !activeLayer.value || !volumeData.value) return

    const center = slicePointToVolume(view, slice, x, y)

    const mark: import('../types/viewer').AnnotationMark = {
      view,
      slice,
      x,
      y,
      radius,
      centerX: center.x,
      centerY: center.y,
      centerZ: center.z,
    }
    if (activeTool.value === 'eraser') {
      mark.eraser = true
    }
    activeLayer.value.annotations.push(mark)
    annotationPreviewVersion.value += 1
  }

  const syncSlicesToVolumePoint = (x: number, y: number, z: number) => {
    if (!volumeData.value) return

    for (const viewport of viewports.value) {
      if (viewport.assignedView === 'threeD') continue

      if (viewport.assignedView === 'axial') {
        const max = getViewMaxSlice('axial', volumeData.value)
        viewport.sliceIndex = Math.max(0, Math.min(max, Math.round(z)))
      } else if (viewport.assignedView === 'coronal') {
        const max = getViewMaxSlice('coronal', volumeData.value)
        viewport.sliceIndex = Math.max(0, Math.min(max, Math.round(y)))
      } else if (viewport.assignedView === 'sagittal') {
        const max = getViewMaxSlice('sagittal', volumeData.value)
        viewport.sliceIndex = Math.max(0, Math.min(max, Math.round(x)))
      }
    }
  }

  const startBoundingBoxDraw = () => {
    activeTool.value = 'boundingBox'
    activeToolbarSection.value = 'manual'
    aiBoundingBox.value = null
  }

  const setBoundingBox = (box: BoundingBox) => {
    aiBoundingBox.value = box
    activeTool.value = 'zoom' // Return to default tool
  }

  const clearBoundingBox = () => {
    aiBoundingBox.value = null
    if (activeTool.value === 'boundingBox') {
      activeTool.value = 'zoom'
    }
  }

  const closeTaskRatingPrompt = (rating?: number) => {
    selectedTaskRating.value = Number.isFinite(rating) ? Number(rating) : null
    taskRatingVisible.value = false
  }

  const setAiMode = (mode: AiMode) => {
    aiMode.value = mode
    if (mode === 'full') {
      clearBoundingBox()
    }
  }

  const selectDetection = (detectionId: string) => {
    const detection = aiDetections.value.find((d) => d.id === detectionId)
    if (!detection || !volumeData.value) return

    selectedDetectionId.value = detectionId
    editingDetectionId.value = null
    activeLayerId.value = detection.layerId

    for (const vp of viewports.value) {
      if (vp.assignedView === 'axial') {
        const max = getViewMaxSlice('axial', volumeData.value)
        vp.sliceIndex = Math.max(0, Math.min(max, Math.round(detection.centerZ)))
      } else if (vp.assignedView === 'coronal') {
        const max = getViewMaxSlice('coronal', volumeData.value)
        vp.sliceIndex = Math.max(0, Math.min(max, Math.round(detection.centerY)))
      } else if (vp.assignedView === 'sagittal') {
        const max = getViewMaxSlice('sagittal', volumeData.value)
        vp.sliceIndex = Math.max(0, Math.min(max, Math.round(detection.centerX)))
      }
    }

  }

  const acceptDetection = (detectionId: string) => {
    const detectionIndex = aiDetections.value.findIndex((d) => d.id === detectionId)
    const detection = detectionIndex >= 0 ? aiDetections.value[detectionIndex] : null
    if (!detection) return

    if (wozEnabled.value) {
      wozLog('participant-accepted', { detectionId })
      sendParticipantMessage({ type: 'detection-action', action: 'accepted', detectionId })
    }

    const layer = findLayerById(detection.layerId)
    if (layer) {
      layer.type = 'manual'
      activeLayerId.value = layer.id
      getManualHistoryBucket(layer.id)
      getManualFutureBucket(layer.id)
    }

    aiDetections.value.splice(detectionIndex, 1)
    if (editingDetectionId.value === detectionId) editingDetectionId.value = null
    if (selectedDetectionId.value === detectionId) selectedDetectionId.value = null

    if (!aiDetections.value.length) {
      aiRunMode.value = null
      aiState.value = 'idle'
      aiProgress.value = 0
    }

    annotationVersion.value++
  }

  const rejectDetection = (detectionId: string) => {
    const detection = aiDetections.value.find((d) => d.id === detectionId)
    if (!detection) return

    if (wozEnabled.value) {
      wozLog('participant-rejected', { detectionId })
      sendParticipantMessage({ type: 'detection-action', action: 'rejected', detectionId })
    }

    aiDetections.value = aiDetections.value.filter((d) => d.id !== detectionId)
    if (editingDetectionId.value === detectionId) editingDetectionId.value = null
    if (selectedDetectionId.value === detectionId) selectedDetectionId.value = null
    deleteLayer(detection.layerId)

    if (!aiDetections.value.length) {
      aiRunMode.value = null
      aiState.value = 'idle'
      aiProgress.value = 0
    }
  }

  const editDetection = (detectionId: string) => {
    const detection = aiDetections.value.find((d) => d.id === detectionId)
    if (!detection || detection.status === 'rejected') return

    if (wozEnabled.value) {
      wozLog('participant-edited', { detectionId })
      sendParticipantMessage({ type: 'detection-action', action: 'edited', detectionId })
    }

    selectDetection(detectionId)
    editingDetectionId.value = detectionId
    detection.wasEdited = true
    activeTool.value = 'brush'
    activeToolbarSection.value = 'manual'
  }

  const acceptAllDetections = () => {
    for (const det of aiDetections.value) {
      if (det.status === 'pending') det.status = 'accepted'
    }
    editingDetectionId.value = null
  }

  const rejectAllDetections = () => {
    for (const det of aiDetections.value) {
      if (det.status === 'pending') {
        det.status = 'rejected'
        const layer = annotationLayers.value.find((l) => l.id === det.layerId)
        if (layer) layer.visible = false
      }
    }
    selectedDetectionId.value = null
    editingDetectionId.value = null
    annotationVersion.value++
  }

  const rejectAi = () => {
    aiState.value = 'rejected'
    aiProgress.value = 0
    annotationLayers.value = annotationLayers.value.filter((layer) => layer.type !== 'ai')
    aiDetections.value = []
    selectedDetectionId.value = null
    editingDetectionId.value = null
    aiRunMode.value = null
    aiBoundingBox.value = null
    annotationVersion.value++
  }

  const acceptAi = () => {
    aiState.value = 'success'
    acceptAllDetections()
  }

  /** After user has reviewed all findings, create a folder layer with accepted ones. */
  const finalizeAiResults = () => {
    const accepted = aiDetections.value.filter((d) => d.status === 'accepted')

    const finalizedLayers: AnnotationLayer[] = []
    for (const detection of accepted) {
      const layer = annotationLayers.value.find((l) => l.id === detection.layerId)
      if (layer) {
        finalizedLayers.push({
          ...layer,
          type: 'manual',
        })
      }
    }

    annotationLayers.value = annotationLayers.value.filter((l) => l.type !== 'ai')

    if (finalizedLayers.length === 0) {
      const layerId = makeId('layer')
      const color = getNextLayerColor()
      finalizedLayers.push({
        id: layerId,
        name: getNextLayerName(),
        type: 'manual',
        visible: true,
        color,
        annotations: [],
      })
    }

    annotationLayers.value = [...finalizedLayers, ...annotationLayers.value]
    activeLayerId.value = finalizedLayers[0]?.id ?? null

    for (const layer of finalizedLayers) {
      getManualHistoryBucket(layer.id)
      getManualFutureBucket(layer.id)
    }

    aiDetections.value = []
    selectedDetectionId.value = null
    editingDetectionId.value = null
    aiRunMode.value = null
    aiState.value = 'idle'
    aiBoundingBox.value = null
    annotationVersion.value++
  }

  const runAi = async () => {
    if (!canRunAi.value || !volumeData.value) return

    aiRunMode.value = aiMode.value
    aiState.value = 'running'
    aiProgress.value = 0
    aiDetections.value = []
    selectedDetectionId.value = null
    editingDetectionId.value = null
    annotationLayers.value = annotationLayers.value.filter((l) => l.type !== 'ai')

    const vol = volumeData.value
    const box = aiBoundingBox.value

    // ── WoZ path: notify wizard and wait for injection ──
    if (wozEnabled.value) {
      wozLog('participant-ran-ai', {
        mode: aiMode.value,
        boundingBox: box ? { view: box.view, slice: box.slice, x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 } : null,
      })

      sendParticipantMessage({
        type: 'ai-requested',
        mode: aiMode.value,
        boundingBox: box,
      })

      // Animate progress to ~85%, then pause
      await new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          aiProgress.value = Math.min(85, aiProgress.value + 5)
          if (aiProgress.value >= 85) {
            window.clearInterval(timer)
            resolve()
          }
        }, 75)
      })

      wozWaitingForWizard.value = true

      // Wait for wizard to inject first detection (listener handles the actual injection)
      await new Promise<WizardCommand>((resolve) => {
        wozResolve = resolve
      })

      // Smooth progress completion
      await new Promise<void>((resolve) => {
        const timer = window.setInterval(() => {
          aiProgress.value = Math.min(100, aiProgress.value + 5)
          if (aiProgress.value >= 100) {
            window.clearInterval(timer)
            resolve()
          }
        }, 40)
      })

      if (box) clearBoundingBox()
      aiState.value = 'success'

      wozLog('wizard-injected-detection', { count: aiDetections.value.length })
      return
    }

    // ── Normal simulation path (no wizard) ──
    await new Promise<void>((resolve) => {
      const timer = window.setInterval(() => {
        aiProgress.value = Math.min(100, aiProgress.value + 7)
        if (aiProgress.value >= 100) {
          window.clearInterval(timer)
          resolve()
        }
      }, 75)
    })

    const namePool = ['Suspicious Focus', 'Lesion Candidate', 'Enhancing Region', 'Tumor Candidate']
    const centerRanges = box
      ? (() => {
          const minX = Math.min(box.x1, box.x2)
          const maxX = Math.max(box.x1, box.x2)
          const minY = Math.min(box.y1, box.y2)
          const maxY = Math.max(box.y1, box.y2)

          if (box.view === 'axial') {
            return {
              x: [minX, maxX] as const,
              y: [minY, maxY] as const,
              z: [Math.max(0, box.slice - 1), Math.min(vol.depth - 1, box.slice + 1)] as const,
              planeSize: Math.max(6, Math.min(maxX - minX, maxY - minY)),
            }
          }

          if (box.view === 'coronal') {
            return {
              x: [minX, maxX] as const,
              y: [Math.max(0, box.slice - 1), Math.min(vol.height - 1, box.slice + 1)] as const,
              z: [minY, maxY] as const,
              planeSize: Math.max(6, Math.min(maxX - minX, maxY - minY)),
            }
          }

          return {
            x: [Math.max(0, box.slice - 1), Math.min(vol.width - 1, box.slice + 1)] as const,
            y: [minX, maxX] as const,
            z: [minY, maxY] as const,
            planeSize: Math.max(6, Math.min(maxX - minX, maxY - minY)),
          }
        })()
      : {
          x: [vol.width * 0.25, vol.width * 0.75] as const,
          y: [vol.height * 0.25, vol.height * 0.75] as const,
          z: [Math.max(1, vol.depth * 0.2), Math.min(vol.depth - 2, vol.depth * 0.8)] as const,
          planeSize: Math.max(6, Math.min(vol.width, vol.height) * 0.2),
        }

    const rawDetections = [
      {
        name: namePool[randomInt(0, namePool.length - 1)] ?? 'Tumor Candidate',
        label: 'Tumor',
        confidence: randomBetween(box ? 0.84 : 0.8, 0.98),
        cx: clamp(randomBetween(centerRanges.x[0], centerRanges.x[1]), 0, vol.width - 1),
        cy: clamp(randomBetween(centerRanges.y[0], centerRanges.y[1]), 0, vol.height - 1),
        cz: clamp(randomBetween(centerRanges.z[0], centerRanges.z[1]), 0, vol.depth - 1),
        radius: Math.max(
          2,
          Math.min(
            centerRanges.planeSize * randomBetween(0.18, 0.34),
            Math.max(3, Math.min(vol.width, vol.height, Math.max(4, vol.depth * 1.2)) * 0.22),
          ),
        ),
        seed: randomInt(1, 10_000),
      },
    ]

    const newDetections: AiDetection[] = []

    for (let i = 0; i < rawDetections.length; i++) {
      const raw = rawDetections[i]!
      const layerId = makeId('ai')
      const color = detectionColors[i % detectionColors.length]!

      const layer: AnnotationLayer = {
        id: layerId,
        name: raw.name,
        type: 'ai',
        visible: true,
        color,
        annotations: generateIrregularAnnotations(raw.cx, raw.cy, raw.cz, raw.radius, vol, raw.seed),
      }

      annotationLayers.value.unshift(layer)

      newDetections.push({
        id: makeId('det'),
        name: raw.name,
        label: raw.label,
        confidence: raw.confidence,
        centerX: raw.cx,
        centerY: raw.cy,
        centerZ: raw.cz,
        radius: raw.radius,
        status: 'pending',
        layerId,
        color,
      })
    }

    aiDetections.value = newDetections
    if (box) {
      clearBoundingBox()
    }

    if (newDetections.length > 0) {
      selectDetection(newDetections[0]!.id)
    }

    aiState.value = 'success'
    annotationVersion.value++
  }

  return {
    currentPatient,
    volumeData,
    isPatientLoaded,
    mriLoaded,
    tumorMaskLoaded,
    layout,
    activeViewportId,
    viewports,
    activeViewport,
    visibleViewports,
    isFullscreenMode,
    activeTool,
    activeToolbarSection,
    renderSettings,
    brushSize,
    showTumorMask,
    annotationLayers,
    annotationVersion,
    annotationPreviewVersion,
    activeLayer,
    activeLayerId,
    selectedLayerHasSelection,
    canAnnotate,
    canUndoManual,
    canRedoManual,
    aiMode,
    aiState,
    aiProgress,
    aiDetections,
    selectedDetectionId,
    editingDetectionId,
    taskRatingQuestion,
    taskRatingVisible,
    selectedTaskRating,
    aiRunMode,
    canRunAi,
    aiBoundingBox,
    loadPatient,
    loadStudentDemo,
    loadMedicalPatient,
    setLayout,
    toggleFullscreenMode,
    setActiveViewport,
    assignViewToActiveViewport,
    assignViewToViewport,
    updateSlice,
    setSlice,
    setActiveToolbarSection,
    setActiveTool,
    updateWindowWidth,
    updateWindowCenter,
    updateZoom,
    setWindowCenter,
    setWindowWidth,
    setContrast,
    setThreshold,
    setBrushSize,
    createManualLayer,
    setActiveLayer,
    toggleFolderExpanded,
    toggleLayerVisibility,
    renameLayer,
    setLayerColor,
    deleteLayer,
    addFindingToFolder,
    beginManualEdit,
    endManualEdit,
    undoManualEdit,
    redoManualEdit,
    resetActiveManualLayer,
    addAnnotation,
    syncSlicesToVolumePoint,
    startBoundingBoxDraw,
    setBoundingBox,
    clearBoundingBox,
    closeTaskRatingPrompt,
    setAiMode,
    selectDetection,
    acceptDetection,
    rejectDetection,
    editDetection,
    acceptAllDetections,
    rejectAllDetections,
    rejectAi,
    acceptAi,
    finalizeAiResults,
    runAi,
    wozEnabled,
    wozWaitingForWizard,
    enableWoz,
    disableWoz,
  }
})
