<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Eye } from 'lucide-vue-next'
import { useViewerStore } from '../stores/viewerStore'
import type { ViewType, ViewportState } from '../types/viewer'
import { fitCanvasToDevicePixelRatio, renderSlice, screenToSlice, type RenderTransform } from '../lib/rendering'
import { renderThreeDVolume, destroyThreeDVolume } from '../lib/rendering3d'
import { getSliceSize, getViewMaxSlice } from '../lib/volume'

const props = defineProps<{
  viewport: ViewportState
  isThumbnail?: boolean
  isFullscreen?: boolean
}>()

const store = useViewerStore()
const {
  volumeData,
  activeViewportId,
  renderSettings,
  annotationLayers,
  showTumorMask,
  compareOverlay,
  isPatientLoaded,
  brushSize,
  activeTool,
  activeLayer,
  canAnnotate,
  aiDetections,
  selectedDetectionId,
} = storeToRefs(store)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvas3DRef = ref<HTMLCanvasElement | null>(null)
const panelRef = ref<HTMLDivElement | null>(null)
const animationFrame = ref<number | null>(null)
const transformRef = ref<RenderTransform>({ drawX: 0, drawY: 0, drawW: 0, drawH: 0 })
const angleXRef = ref(0)
const angleYRef = ref(0)
const zoom3DRef = ref(1)
const pan3DXRef = ref(0)
const pan3DYRef = ref(0)
const isDragging3D = ref(false)
const isPanning = ref(false)
const lastDragPos = ref<{ x: number; y: number } | null>(null)
const activeMouseButton = ref<number | null>(null)
const isDrawing = ref(false)
const cursorPoint = ref<{ x: number; y: number } | null>(null)
const lastDrawnPoint = ref<{ x: number; y: number; slice: number; view: Exclude<ViewType, 'threeD'> } | null>(null)
let resizeObserver: ResizeObserver | null = null

const isActive = computed(() => activeViewportId.value === props.viewport.id)

const availableViews: Array<{ key: ViewType; label: string }> = [
  { key: 'axial', label: 'Axial' },
  { key: 'sagittal', label: 'Sagittal' },
  { key: 'coronal', label: 'Coronal' },
  { key: 'threeD', label: '3D' },
]

const visibleLayers = computed(() => {
  if (compareOverlay.value) return annotationLayers.value.filter((layer) => layer.type === 'ai')
  return annotationLayers.value
})

const highlightLayerId = computed(() => {
  if (!selectedDetectionId.value) return undefined
  const detection = aiDetections.value.find((d) => d.id === selectedDetectionId.value)
  return detection?.layerId
})

const maxSlice = computed(() => {
  if (!volumeData.value || props.viewport.assignedView === 'threeD') return 0
  return getViewMaxSlice(props.viewport.assignedView, volumeData.value)
})

const getAnnotationRadius = (): number => {
  if (activeTool.value === 'fill') return Math.min(36, brushSize.value + 4)
  return brushSize.value
}

const previewRadiusPx = computed(() => {
  if (!volumeData.value || !canvasRef.value || props.viewport.assignedView === 'threeD') return 0
  const { width } = getSliceSize(props.viewport.assignedView, volumeData.value)
  const pixelRatio = canvasRef.value.clientWidth > 0 ? canvasRef.value.width / canvasRef.value.clientWidth : window.devicePixelRatio || 1
  const drawWidthCssPx = transformRef.value.drawW / Math.max(pixelRatio, 1)
  const scale =
    transformRef.value.rotated && transformRef.value.sourceHeight
      ? drawWidthCssPx / transformRef.value.sourceHeight
      : drawWidthCssPx / width
  return Math.max(1, getAnnotationRadius() * scale)
})

const showBrushPreview = computed(
  () =>
    !!cursorPoint.value &&
    canAnnotate.value &&
    activeTool.value === 'brush' &&
    props.viewport.assignedView !== 'threeD' &&
    activeViewportId.value === props.viewport.id,
)

const hideNativeCursor = computed(
  () =>
    activeTool.value === 'brush' &&
    canAnnotate.value &&
    props.viewport.assignedView !== 'threeD' &&
    activeViewportId.value === props.viewport.id,
)

const brushPreviewStyle = computed(() => {
  if (!cursorPoint.value || !showBrushPreview.value) return {}
  const color = activeLayer.value?.color ?? '#f97316'
  const radius = previewRadiusPx.value
  return {
    left: `${cursorPoint.value.x}px`,
    top: `${cursorPoint.value.y}px`,
    transform: 'translate(-50%, -50%)',
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
    borderColor: color,
    backgroundColor: `${color}2e`,
  }
})

const draw2D = () => {
  if (!canvasRef.value || !volumeData.value || props.viewport.assignedView === 'threeD') return

  transformRef.value = renderSlice(
    canvasRef.value,
    props.viewport.assignedView,
    props.viewport.sliceIndex,
    volumeData.value,
    renderSettings.value,
    visibleLayers.value,
    showTumorMask.value,
    false,
    highlightLayerId.value,
  )
}

const draw3D = () => {
  if (!canvas3DRef.value || !volumeData.value || props.viewport.assignedView !== 'threeD') return
  renderThreeDVolume(
    canvas3DRef.value,
    volumeData.value,
    angleYRef.value,
    angleXRef.value,
    zoom3DRef.value,
    pan3DXRef.value,
    pan3DYRef.value,
  )
}

const handle3DPointerDown = (event: PointerEvent) => {
  if (props.viewport.assignedView !== 'threeD') return

  activeMouseButton.value = event.button
  lastDragPos.value = { x: event.clientX, y: event.clientY }
  canvas3DRef.value?.setPointerCapture(event.pointerId)

  if (event.button === 2) {
    // Right button: rotate
    isDragging3D.value = true
  } else {
    // Left button: pan
    isPanning.value = true
  }
}

const handle3DPointerMove = (event: PointerEvent) => {
  if ((!isDragging3D.value && !isPanning.value) || !lastDragPos.value || props.viewport.assignedView !== 'threeD') return

  const deltaX = event.clientX - lastDragPos.value.x
  const deltaY = event.clientY - lastDragPos.value.y

  if (isDragging3D.value) {
    // Right button: rotate
    angleYRef.value += deltaX * 0.01
    angleXRef.value += deltaY * 0.01
    angleXRef.value = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angleXRef.value))
  } else if (isPanning.value) {
    // Left button: pan
    pan3DXRef.value += deltaX
    pan3DYRef.value += deltaY
  }

  lastDragPos.value = { x: event.clientX, y: event.clientY }
  draw3D()
}

const handle3DPointerUp = (event: PointerEvent) => {
  if (props.viewport.assignedView !== 'threeD') return
  isDragging3D.value = false
  isPanning.value = false
  activeMouseButton.value = null
  lastDragPos.value = null
  canvas3DRef.value?.releasePointerCapture(event.pointerId)
}

const handle3DWheel = (event: WheelEvent) => {
  if (props.viewport.assignedView !== 'threeD') return
  event.preventDefault()

  // Exponential zoom — each scroll step scales by 10 %, no practical upper limit
  const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
  zoom3DRef.value = Math.max(0.3, Math.min(500, zoom3DRef.value * factor))
  draw3D()
}

// 2D Pan handlers
const handle2DPanStart = (event: PointerEvent) => {
  isPanning.value = true
  lastDragPos.value = { x: event.clientX, y: event.clientY }
  canvasRef.value?.setPointerCapture(event.pointerId)
}

const handle2DPanMove = (event: PointerEvent) => {
  if (!isPanning.value || !lastDragPos.value) return

  const deltaX = event.clientX - lastDragPos.value.x
  const deltaY = event.clientY - lastDragPos.value.y

  // Update render settings pan
  renderSettings.value.panX += deltaX
  renderSettings.value.panY += deltaY

  lastDragPos.value = { x: event.clientX, y: event.clientY }
  draw2D()
}

const handle2DPanEnd = (event: PointerEvent) => {
  isPanning.value = false
  lastDragPos.value = null
  canvasRef.value?.releasePointerCapture(event.pointerId)
}

const draw = () => {
  if (!isPatientLoaded.value) {
    // Clear 2D canvas
    if (canvasRef.value) {
      fitCanvasToDevicePixelRatio(canvasRef.value)
      const ctx = canvasRef.value.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#27272a'
        ctx.fillRect(0, 0, canvasRef.value.width, canvasRef.value.height)
      }
    }
    return
  }

  if (props.viewport.assignedView === 'threeD') {
    if (animationFrame.value) window.cancelAnimationFrame(animationFrame.value)
    draw3D()
    return
  }

  if (animationFrame.value) {
    window.cancelAnimationFrame(animationFrame.value)
    animationFrame.value = null
  }

  draw2D()
}

const handleWheel = (event: WheelEvent) => {
  event.preventDefault()
  if (!isPatientLoaded.value) return

  // Handle 3D zoom
  if (props.viewport.assignedView === 'threeD') {
    handle3DWheel(event)
    return
  }

  const delta = event.deltaY > 0 ? 1 : -1
  if (props.isFullscreen) {
    store.updateFullscreenSlice(delta)
  } else {
    store.updateSlice(props.viewport.id, delta)
  }
}

const mapPointerToSlice = (event: PointerEvent): { x: number; y: number; mappedX: number; mappedY: number } | null => {
  if (!volumeData.value || !canvasRef.value || props.viewport.assignedView === 'threeD') return null

  const rect = canvasRef.value.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const x = (event.clientX - rect.left) * ratio
  const y = (event.clientY - rect.top) * ratio

  const { width, height } = getSliceSize(props.viewport.assignedView, volumeData.value)
  const mapped = screenToSlice(x, y, transformRef.value, width, height)
  if (!mapped) return null

  return { x: event.clientX - rect.left, y: event.clientY - rect.top, mappedX: mapped.x, mappedY: mapped.y }
}

const drawInterpolatedMarks = (
  view: Exclude<ViewType, 'threeD'>,
  slice: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
) => {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const distance = Math.hypot(deltaX, deltaY)
  if (distance < 0.01) return

  // Keep overlap between circles high enough so strokes appear continuous.
  const spacing = Math.max(0.2, radius * 0.3)
  const stepCount = Math.max(1, Math.ceil(distance / spacing))
  for (let step = 1; step <= stepCount; step += 1) {
    const t = step / stepCount
    store.addAnnotation(view, slice, start.x + deltaX * t, start.y + deltaY * t, radius)
  }
}

const drawAtPointer = (event: PointerEvent) => {
  const pointer = mapPointerToSlice(event)
  cursorPoint.value = pointer ? { x: pointer.x, y: pointer.y } : null

  if (!pointer || !canAnnotate.value || props.viewport.assignedView === 'threeD') return

  const radius = getAnnotationRadius()
  const view = props.viewport.assignedView as Exclude<ViewType, 'threeD'>
  const lastPoint = lastDrawnPoint.value

  if (lastPoint && lastPoint.slice === props.viewport.sliceIndex && lastPoint.view === view) {
    drawInterpolatedMarks(
      view,
      props.viewport.sliceIndex,
      { x: lastPoint.x, y: lastPoint.y },
      { x: pointer.mappedX, y: pointer.mappedY },
      radius,
    )
  } else {
    store.addAnnotation(view, props.viewport.sliceIndex, pointer.mappedX, pointer.mappedY, radius)
  }

  lastDrawnPoint.value = {
    x: pointer.mappedX,
    y: pointer.mappedY,
    slice: props.viewport.sliceIndex,
    view,
  }
}

const releaseDrawing = (pointerId?: number) => {
  if (isDrawing.value) {
    store.endManualEdit()
  }
  isDrawing.value = false
  lastDrawnPoint.value = null
  if (pointerId === undefined || !canvasRef.value) return
  if (canvasRef.value.hasPointerCapture(pointerId)) {
    canvasRef.value.releasePointerCapture(pointerId)
  }
}

const handlePointerDown = (event: PointerEvent) => {
  store.setActiveViewport(props.viewport.id)

  // Handle 3D view
  if (props.viewport.assignedView === 'threeD') {
    handle3DPointerDown(event)
    return
  }

  // Handle 2D views
  activeMouseButton.value = event.button

  // Right button (2) or Pan tool + left button = Pan mode
  if (event.button === 2 || (event.button === 0 && activeTool.value === 'pan')) {
    handle2DPanStart(event)
    return
  }

  // Left button with annotation tools
  if (!canAnnotate.value || !canvasRef.value) return

  store.beginManualEdit()
  isDrawing.value = true
  lastDrawnPoint.value = null
  canvasRef.value.setPointerCapture(event.pointerId)
  drawAtPointer(event)
}

const handlePointerMove = (event: PointerEvent) => {
  // Handle 3D view
  if (props.viewport.assignedView === 'threeD') {
    handle3DPointerMove(event)
    return
  }

  // Handle 2D panning
  if (isPanning.value) {
    handle2DPanMove(event)
    return
  }

  const pointer = mapPointerToSlice(event)
  cursorPoint.value = pointer ? { x: pointer.x, y: pointer.y } : null
  if (!isDrawing.value) return
  drawAtPointer(event)
}

const handlePointerUp = (event: PointerEvent) => {
  // Handle 3D view
  if (props.viewport.assignedView === 'threeD') {
    handle3DPointerUp(event)
    return
  }

  // Handle 2D panning
  if (isPanning.value) {
    handle2DPanEnd(event)
    return
  }

  activeMouseButton.value = null
  releaseDrawing(event.pointerId)
}

const handlePointerLeave = () => {
  cursorPoint.value = null
  if (!isPanning.value) {
    releaseDrawing()
  }
}

const handleViewAssignment = (event: Event) => {
  const target = event.target as HTMLSelectElement
  const view = target.value as ViewType
  if (props.isFullscreen) {
    store.setFullscreenView(view)
  } else {
    store.assignViewToViewport(props.viewport.id, view)
  }
}

onMounted(() => {
  draw()
  if (panelRef.value) {
    resizeObserver = new ResizeObserver(() => draw())
    resizeObserver.observe(panelRef.value)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver && panelRef.value) resizeObserver.unobserve(panelRef.value)
  if (animationFrame.value) window.cancelAnimationFrame(animationFrame.value)
  if (canvas3DRef.value) destroyThreeDVolume(canvas3DRef.value)
  releaseDrawing()
})

watch(
  [
    () => props.viewport.assignedView,
    () => props.viewport.sliceIndex,
    volumeData,
    renderSettings,
    annotationLayers,
    showTumorMask,
    compareOverlay,
    selectedDetectionId,
  ],
  () => draw(),
  { deep: true },
)

watch(
  () => props.viewport.assignedView,
  () => {
    cursorPoint.value = null
    releaseDrawing()
  },
)

watch(canAnnotate, (next) => {
  if (!next) {
    cursorPoint.value = null
    releaseDrawing()
  }
})

watch(activeViewportId, (next) => {
  if (next !== props.viewport.id) {
    cursorPoint.value = null
    releaseDrawing()
  }
})
</script>

<template>
  <article
    ref="panelRef"
    class="relative h-full min-h-0 overflow-hidden rounded-2xl border bg-zinc-900 shadow-panel transition"
    :class="isActive ? 'border-zinc-900 ring-2 ring-zinc-300' : 'border-zinc-300'"
  >
    <div v-if="!isThumbnail" class="absolute left-2 top-2 z-20 inline-flex items-center gap-2 rounded-lg bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-100 backdrop-blur-sm">
      <Eye class="h-3 w-3" />
      <span class="font-semibold uppercase tracking-wide">{{ viewport.assignedView === 'threeD' ? '3D' : viewport.assignedView }}</span>
      <span v-if="viewport.assignedView !== 'threeD'" class="text-zinc-300">Slice {{ viewport.sliceIndex }}</span>
    </div>

    <div v-if="!isThumbnail" class="absolute right-2 top-2 z-20">
      <select
        class="rounded-lg border border-zinc-700 bg-zinc-900/75 px-2 py-1 text-[11px] font-medium text-zinc-100 outline-none"
        :value="viewport.assignedView"
        @change="handleViewAssignment"
      >
        <option v-for="view in availableViews" :key="view.key" :value="view.key">{{ view.label }}</option>
      </select>
    </div>

    <!-- 2D Canvas for slice views -->
    <canvas
      v-show="viewport.assignedView !== 'threeD'"
      ref="canvasRef"
      class="h-full w-full touch-none"
      :class="{ 'cursor-none': hideNativeCursor }"
      @wheel="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @pointerleave="handlePointerLeave"
      @contextmenu.prevent
    />

    <!-- WebGL Canvas for 3D volume rendering -->
    <canvas
      v-show="viewport.assignedView === 'threeD'"
      ref="canvas3DRef"
      class="h-full w-full touch-none"
      @wheel="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @pointerleave="handlePointerLeave"
      @contextmenu.prevent
    />

    <div v-if="showBrushPreview" class="pointer-events-none absolute z-20 rounded-full border-2" :style="brushPreviewStyle" />

    <!-- 3D hint text -->
    <div
      v-if="viewport.assignedView === 'threeD' && isPatientLoaded && !isThumbnail"
      class="pointer-events-none absolute bottom-2 left-2 z-20 text-[11px] text-zinc-400/60"
    >
      Drag to pan · Right-click to rotate · Scroll to zoom
    </div>

    <div
      v-if="viewport.assignedView !== 'threeD' && isPatientLoaded && !isThumbnail"
      class="absolute bottom-2 left-2 right-2 z-20 rounded-lg bg-zinc-950/70 px-2 py-1.5 backdrop-blur-sm"
    >
      <input
        type="range"
        class="w-full accent-zinc-200"
        min="0"
        :max="maxSlice"
        :value="viewport.sliceIndex"
        @input="isFullscreen ? store.setFullscreenSlice(Number(($event.target as HTMLInputElement).value)) : store.setSlice(viewport.id, Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </article>
</template>
