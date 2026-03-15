import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { mockPatient } from '../data/mockPatient'
import { createMockBrainVolume } from '../data/mockVolume'
import { makeId } from '../lib/ids'
import { loadNiftiFile } from '../lib/niftiLoader'
import { getDefaultSliceForView, getViewMaxSlice } from '../lib/volume'
import type {
  AiMode,
  AiState,
  AnnotationLayer,
  AnnotationMark,
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

const colors = ['#f97316', '#06b6d4', '#f43f5e', '#22c55e', '#8b5cf6', '#0ea5e9', '#eab308']
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const cloneAnnotations = (marks: AnnotationMark[]): AnnotationMark[] => marks.map((mark) => ({ ...mark }))

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
  { id: 'vp-1', label: 'Viewport 1', assignedView: 'axial', sliceIndex: 36 },
  { id: 'vp-2', label: 'Viewport 2', assignedView: 'sagittal', sliceIndex: 64 },
  { id: 'vp-3', label: 'Viewport 3', assignedView: 'coronal', sliceIndex: 64 },
  { id: 'vp-4', label: 'Viewport 4', assignedView: 'threeD', sliceIndex: 0 },
]

export const useViewerStore = defineStore('viewer', () => {
  const currentPatient = ref<typeof mockPatient | null>(null)
  const volumeData = ref<VolumeData | null>(null)

  const isPatientLoaded = ref(false)
  const mriLoaded = ref(false)
  const tumorMaskLoaded = ref(false)

  const layout = ref<LayoutMode>('2x2')
  const activeViewportId = ref('vp-1')
  const viewports = ref<ViewportState[]>(defaultViewports())
  const isFullscreenMode = ref(false)
  const fullscreenViewportId = ref<string | null>(null)
  const fullscreenViewportState = ref<ViewportState | null>(null)

  const activeTool = ref<ToolId>('zoom')
  const activeToolbarSection = ref<ToolbarSection>('image')

  const renderSettings = ref<RenderSettings>(defaultRenderSettings())
  const brushSize = ref(2.5)
  const showTumorMask = ref(true)

  const annotationLayers = ref<AnnotationLayer[]>([])
  const activeLayerId = ref<string | null>(null)
  const manualHistory = ref<Record<string, AnnotationMark[][]>>({})
  const manualFuture = ref<Record<string, AnnotationMark[][]>>({})

  const aiMode = ref<AiMode>('full')
  const aiState = ref<AiState>('idle')
  const aiProgress = ref(0)
  const compareOverlay = ref(false)
  const activeViewport = computed<ViewportState | null>(
    () => viewports.value.find((viewport) => viewport.id === activeViewportId.value) ?? viewports.value[0] ?? null,
  )

  const activeLayer = computed(() =>
    annotationLayers.value.find((layer) => layer.id === activeLayerId.value) ?? null,
  )

  const selectedLayerHasSelection = computed(() => (activeLayer.value?.annotations.length ?? 0) > 0)

  const visibleViewports = computed(() => {
    if (layout.value === '2x2') return viewports.value
    if (layout.value === '3x1') return viewports.value.slice(0, 3)
    return activeViewport.value ? [activeViewport.value] : []
  })

  const canAnnotate = computed(
    () =>
      isPatientLoaded.value &&
      manualTools.includes(activeTool.value) &&
      !!activeLayer.value &&
      activeLayer.value.type === 'manual',
  )

  const canRunAi = computed(() => {
    if (!isPatientLoaded.value || !activeLayer.value || aiState.value === 'running') return false
    if (aiMode.value === 'semi') return selectedLayerHasSelection.value
    return true
  })

  const canUndoManual = computed(() => {
    const layer = activeLayer.value
    if (!layer || layer.type !== 'manual') return false
    return (manualHistory.value[layer.id]?.length ?? 0) > 0
  })

  const canRedoManual = computed(() => {
    const layer = activeLayer.value
    if (!layer || layer.type !== 'manual') return false
    return (manualFuture.value[layer.id]?.length ?? 0) > 0
  })

  const getNextLayerColor = (): string => colors[annotationLayers.value.length % colors.length] ?? '#0ea5e9'

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
    if (layer.type !== 'manual') return
    const history = getManualHistoryBucket(layer.id)
    history.push(cloneAnnotations(layer.annotations))
    if (history.length > MAX_HISTORY_SIZE) {
      history.shift()
    }
    manualFuture.value[layer.id] = []
  }

  const loadPatient = () => {
    const volume = createMockBrainVolume()
    volumeData.value = volume
    currentPatient.value = mockPatient

    isPatientLoaded.value = true
    mriLoaded.value = true
    tumorMaskLoaded.value = true
    showTumorMask.value = true

    renderSettings.value = defaultRenderSettings()
    annotationLayers.value = []
    activeLayerId.value = null
    manualHistory.value = {}
    manualFuture.value = {}
    compareOverlay.value = false
    aiState.value = 'idle'
    aiProgress.value = 0
    brushSize.value = 2.5

    viewports.value = defaultViewports().map((viewport) => {
      if (viewport.assignedView === 'threeD') return viewport
      return {
        ...viewport,
        sliceIndex: getDefaultSliceForView(viewport.assignedView, volume),
      }
    })
    activeViewportId.value = 'vp-1'
  }

  const loadNiftiPatient = async (file: File, patientName?: string) => {
    try {
      const volume = await loadNiftiFile(file)
      volumeData.value = volume

      // Create a custom patient from the file
      currentPatient.value = {
        id: makeId('patient'),
        name: patientName || file.name.replace(/\.(nii|nii\.gz)$/, ''),
        age: 0,
        scanDate: new Date().toISOString().split('T')[0] || '', // Ensure scanDate is always a string
        studyType: 'MRI',
      }

      isPatientLoaded.value = true
      mriLoaded.value = true
      tumorMaskLoaded.value = false
      showTumorMask.value = false

      renderSettings.value = defaultRenderSettings()
      annotationLayers.value = []
      activeLayerId.value = null
      brushSize.value = 2.5

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
    } catch (error) {
      console.error('Failed to load NIfTI file:', error)
    }
  }

  const setLayout = (next: LayoutMode) => {
    layout.value = next
  }

  const toggleFullscreenMode = (viewportId?: string) => {
    if (isFullscreenMode.value) {
      // Exit fullscreen
      isFullscreenMode.value = false
      fullscreenViewportId.value = null
      fullscreenViewportState.value = null
    } else {
      // Enter fullscreen with the specified viewport or active viewport
      const targetId = viewportId ?? activeViewportId.value
      const sourceViewport = viewports.value.find(vp => vp.id === targetId)
      if (sourceViewport) {
        // Create a copy of the viewport for fullscreen mode
        fullscreenViewportState.value = {
          ...sourceViewport,
          id: 'fullscreen-vp',
          label: 'Fullscreen',
        }
      }
      isFullscreenMode.value = true
      fullscreenViewportId.value = targetId
    }
  }

  const switchFullscreenViewport = (viewportId: string) => {
    if (!isFullscreenMode.value) return
    fullscreenViewportId.value = viewportId
    activeViewportId.value = viewportId
  }

  const setFullscreenView = (view: ViewType) => {
    if (!isFullscreenMode.value || !fullscreenViewportState.value) return
    fullscreenViewportState.value.assignedView = view
    if (volumeData.value && view !== 'threeD') {
      fullscreenViewportState.value.sliceIndex = getDefaultSliceForView(view, volumeData.value)
    }
  }

  const setFullscreenSlice = (value: number) => {
    if (!fullscreenViewportState.value || !volumeData.value || fullscreenViewportState.value.assignedView === 'threeD') return
    const maxSlice = getViewMaxSlice(fullscreenViewportState.value.assignedView, volumeData.value)
    fullscreenViewportState.value.sliceIndex = Math.max(0, Math.min(maxSlice, value))
  }

  const updateFullscreenSlice = (delta: number) => {
    if (!fullscreenViewportState.value || !volumeData.value || fullscreenViewportState.value.assignedView === 'threeD') return
    const maxSlice = getViewMaxSlice(fullscreenViewportState.value.assignedView, volumeData.value)
    fullscreenViewportState.value.sliceIndex = Math.max(0, Math.min(maxSlice, fullscreenViewportState.value.sliceIndex + delta))
  }

  const setActiveViewport = (viewportId: string) => {
    activeViewportId.value = viewportId
  }

  const assignViewToActiveViewport = (view: ViewType) => {
    const viewport = activeViewport.value
    if (!viewport) return
    viewport.assignedView = view
    if (volumeData.value && view !== 'threeD') {
      viewport.sliceIndex = getDefaultSliceForView(view, volumeData.value)
    }
  }

  const assignViewToViewport = (viewportId: string, view: ViewType) => {
    const viewport = viewports.value.find((entry) => entry.id === viewportId)
    if (!viewport) return
    viewport.assignedView = view
    if (volumeData.value && view !== 'threeD') {
      viewport.sliceIndex = getDefaultSliceForView(view, volumeData.value)
    }
  }

  const updateSlice = (viewportId: string, delta: number) => {
    const viewport = viewports.value.find((entry) => entry.id === viewportId)
    if (!viewport || !volumeData.value || viewport.assignedView === 'threeD') return

    const maxSlice = getViewMaxSlice(viewport.assignedView, volumeData.value)
    viewport.sliceIndex = Math.max(0, Math.min(maxSlice, viewport.sliceIndex + delta))
  }

  const setSlice = (viewportId: string, value: number) => {
    const viewport = viewports.value.find((entry) => entry.id === viewportId)
    if (!viewport || !volumeData.value || viewport.assignedView === 'threeD') return

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
    const layer: AnnotationLayer = {
      id: makeId('layer'),
      name: `Manual Layer ${annotationLayers.value.length + 1}`,
      type: 'manual',
      visible: true,
      color: getNextLayerColor(),
      annotations: [],
    }

    annotationLayers.value.unshift(layer)
    activeLayerId.value = layer.id
    getManualHistoryBucket(layer.id)
    getManualFutureBucket(layer.id)
  }

  const setActiveLayer = (layerId: string) => {
    activeLayerId.value = layerId
  }

  const toggleLayerVisibility = (layerId: string) => {
    const layer = annotationLayers.value.find((entry) => entry.id === layerId)
    if (!layer) return
    layer.visible = !layer.visible
  }

  const deleteLayer = (layerId: string) => {
    annotationLayers.value = annotationLayers.value.filter((layer) => layer.id !== layerId)
    delete manualHistory.value[layerId]
    delete manualFuture.value[layerId]
    if (activeLayerId.value === layerId) {
      activeLayerId.value = annotationLayers.value[0]?.id ?? null
    }
  }

  const beginManualEdit = () => {
    const layer = activeLayer.value
    if (!layer || layer.type !== 'manual') return
    pushManualHistorySnapshot(layer)
  }

  const endManualEdit = () => {
    // Reserved for future batching hooks.
  }

  const undoManualEdit = () => {
    const layer = activeLayer.value
    if (!layer || layer.type !== 'manual') return
    const history = getManualHistoryBucket(layer.id)
    const future = getManualFutureBucket(layer.id)
    if (!history.length) return
    future.push(cloneAnnotations(layer.annotations))
    layer.annotations = history.pop() ?? []
  }

  const redoManualEdit = () => {
    const layer = activeLayer.value
    if (!layer || layer.type !== 'manual') return
    const future = getManualFutureBucket(layer.id)
    const history = getManualHistoryBucket(layer.id)
    if (!future.length) return
    history.push(cloneAnnotations(layer.annotations))
    layer.annotations = future.pop() ?? []
  }

  const resetActiveManualLayer = () => {
    const layer = activeLayer.value
    if (!layer || layer.type !== 'manual' || !layer.annotations.length) return
    pushManualHistorySnapshot(layer)
    layer.annotations = []
  }

  const addAnnotation = (
    view: Exclude<ViewType, 'threeD'>,
    slice: number,
    x: number,
    y: number,
    radius: number,
  ) => {
    if (!canAnnotate.value || !activeLayer.value) return

    if (activeTool.value === 'eraser') {
      activeLayer.value.annotations = activeLayer.value.annotations.filter(
        (mark) =>
          !(mark.view === view && mark.slice === slice && Math.hypot(mark.x - x, mark.y - y) <= mark.radius + radius),
      )
      return
    }

    activeLayer.value.annotations.push({ view, slice, x, y, radius })
  }

  const setAiMode = (mode: AiMode) => {
    aiMode.value = mode
  }

  const setCompareOverlay = () => {
    compareOverlay.value = !compareOverlay.value
  }

  const rejectAi = () => {
    aiState.value = 'rejected'
    aiProgress.value = 0
    annotationLayers.value = annotationLayers.value.filter((layer) => layer.type !== 'ai')
  }

  const acceptAi = () => {
    aiState.value = 'success'
  }

  const runAi = async (mode: 'run' | 'refine') => {
    if (!canRunAi.value || !volumeData.value) return

    aiState.value = 'running'
    aiProgress.value = 0

    await new Promise<void>((resolve) => {
      const timer = window.setInterval(() => {
        aiProgress.value = Math.min(100, aiProgress.value + (mode === 'run' ? 7 : 11))
        if (aiProgress.value >= 100) {
          window.clearInterval(timer)
          resolve()
        }
      }, 75)
    })

    const aiLayer: AnnotationLayer = {
      id: makeId('ai'),
      name: mode === 'run' ? 'AI Tumor Proposal' : 'AI Refined Proposal',
      type: 'ai',
      visible: true,
      color: '#ef4444',
      annotations: [],
    }

    const centerX = Math.floor(volumeData.value.width * 0.62)
    const centerY = Math.floor(volumeData.value.height * 0.46)
    const centerZ = Math.floor(volumeData.value.depth * 0.52)

    for (let i = 0; i < 16; i += 1) {
      const jitter = (Math.random() - 0.5) * 12
      aiLayer.annotations.push({
        view: 'axial',
        slice: centerZ + Math.round((Math.random() - 0.5) * 8),
        x: centerX + jitter,
        y: centerY + jitter * 0.6,
        radius: mode === 'run' ? 8 : 6,
      })
      aiLayer.annotations.push({
        view: 'coronal',
        slice: centerY + Math.round((Math.random() - 0.5) * 8),
        x: centerX + jitter * 0.8,
        y: centerZ + jitter * 0.5,
        radius: mode === 'run' ? 7 : 5,
      })
      aiLayer.annotations.push({
        view: 'sagittal',
        slice: centerX + Math.round((Math.random() - 0.5) * 8),
        x: centerY + jitter,
        y: centerZ + jitter * 0.4,
        radius: mode === 'run' ? 7 : 5,
      })
    }

    annotationLayers.value = annotationLayers.value.filter((layer) => layer.type !== 'ai')
    annotationLayers.value.unshift(aiLayer)
    activeLayerId.value = aiLayer.id
    aiState.value = 'success'
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
    fullscreenViewportId,
    fullscreenViewportState,
    activeTool,
    activeToolbarSection,
    renderSettings,
    brushSize,
    showTumorMask,
    annotationLayers,
    activeLayer,
    activeLayerId,
    selectedLayerHasSelection,
    canAnnotate,
    canUndoManual,
    canRedoManual,
    aiMode,
    aiState,
    aiProgress,
    compareOverlay,
    canRunAi,
    loadPatient,
    loadNiftiPatient,
    setLayout,
    toggleFullscreenMode,
    switchFullscreenViewport,
    setFullscreenView,
    setFullscreenSlice,
    updateFullscreenSlice,
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
    toggleLayerVisibility,
    deleteLayer,
    beginManualEdit,
    endManualEdit,
    undoManualEdit,
    redoManualEdit,
    resetActiveManualLayer,
    addAnnotation,
    setAiMode,
    setCompareOverlay,
    rejectAi,
    acceptAi,
    runAi,
  }
})
