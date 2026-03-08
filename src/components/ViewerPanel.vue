<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Eye } from 'lucide-vue-next'
import { useViewerStore } from '../stores/viewerStore'
import type { ViewType, ViewportState } from '../types/viewer'
import { fitCanvasToDevicePixelRatio, renderSlice, renderThreeD, screenToSlice, type RenderTransform } from '../lib/rendering'
import { getSliceSize, getViewMaxSlice } from '../lib/volume'

const props = defineProps<{
  viewport: ViewportState
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
  layout,
  brushSize,
  activeTool,
  activeLayer,
  canAnnotate,
} = storeToRefs(store)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const panelRef = ref<HTMLDivElement | null>(null)
const animationFrame = ref<number | null>(null)
const transformRef = ref<RenderTransform>({ drawX: 0, drawY: 0, drawW: 0, drawH: 0 })
const angleRef = ref(0)
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

const maxSlice = computed(() => {
  if (!volumeData.value || props.viewport.assignedView === 'threeD') return 0
  return getViewMaxSlice(props.viewport.assignedView, volumeData.value)
})

const getAnnotationRadius = (): number => {
  if (activeTool.value === 'fill') return Math.min(36, brushSize.value + 4)
  return brushSize.value
}

const previewRadiusPx = computed(() => {
  if (!volumeData.value || props.viewport.assignedView === 'threeD') return 0
  const { width } = getSliceSize(props.viewport.assignedView, volumeData.value)
  const scale =
    transformRef.value.rotated && transformRef.value.sourceHeight
      ? transformRef.value.drawW / transformRef.value.sourceHeight
      : transformRef.value.drawW / width
  return Math.max(3, getAnnotationRadius() * scale)
})

const showBrushPreview = computed(
  () =>
    !!cursorPoint.value &&
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
    layout.value === '3x1',
  )
}

const draw3D = () => {
  if (!canvasRef.value || !volumeData.value || props.viewport.assignedView !== 'threeD') return
  renderThreeD(canvasRef.value, store.threeDMaskPoints, angleRef.value)
  angleRef.value += 0.01
  animationFrame.value = window.requestAnimationFrame(draw3D)
}

const draw = () => {
  if (!canvasRef.value) return
  if (!isPatientLoaded.value) {
    fitCanvasToDevicePixelRatio(canvasRef.value)
    const ctx = canvasRef.value.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#27272a'
    ctx.fillRect(0, 0, canvasRef.value.width, canvasRef.value.height)
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
  if (props.viewport.assignedView === 'threeD') return
  store.updateSlice(props.viewport.id, event.deltaY > 0 ? 1 : -1)
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

const drawAtPointer = (event: PointerEvent) => {
  const pointer = mapPointerToSlice(event)
  cursorPoint.value = pointer ? { x: pointer.x, y: pointer.y } : null

  if (!pointer || !canAnnotate.value || props.viewport.assignedView === 'threeD') return

  const radius = getAnnotationRadius()
  const spacing = Math.max(1.2, radius * 0.42)
  const view = props.viewport.assignedView as Exclude<ViewType, 'threeD'>
  const lastPoint = lastDrawnPoint.value

  if (
    lastPoint &&
    lastPoint.slice === props.viewport.sliceIndex &&
    lastPoint.view === view &&
    Math.hypot(lastPoint.x - pointer.mappedX, lastPoint.y - pointer.mappedY) < spacing
  ) {
    return
  }

  store.addAnnotation(view, props.viewport.sliceIndex, pointer.mappedX, pointer.mappedY, radius)
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
  if (!canAnnotate.value || props.viewport.assignedView === 'threeD' || !canvasRef.value) return

  store.beginManualEdit()
  isDrawing.value = true
  lastDrawnPoint.value = null
  canvasRef.value.setPointerCapture(event.pointerId)
  drawAtPointer(event)
}

const handlePointerMove = (event: PointerEvent) => {
  const pointer = mapPointerToSlice(event)
  cursorPoint.value = pointer ? { x: pointer.x, y: pointer.y } : null
  if (!isDrawing.value) return
  drawAtPointer(event)
}

const handlePointerUp = (event: PointerEvent) => {
  releaseDrawing(event.pointerId)
}

const handlePointerLeave = () => {
  cursorPoint.value = null
  releaseDrawing()
}

const handleViewAssignment = (event: Event) => {
  const target = event.target as HTMLSelectElement
  store.assignViewToViewport(props.viewport.id, target.value as ViewType)
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
    class="relative min-h-[240px] overflow-hidden rounded-2xl border bg-zinc-900 shadow-panel transition"
    :class="isActive ? 'border-zinc-900 ring-2 ring-zinc-300' : 'border-zinc-300'"
  >
    <div class="absolute left-2 top-2 z-20 inline-flex items-center gap-2 rounded-lg bg-zinc-950/70 px-2 py-1 text-[11px] text-zinc-100 backdrop-blur-sm">
      <Eye class="h-3 w-3" />
      <span class="font-semibold uppercase tracking-wide">{{ viewport.assignedView === 'threeD' ? '3D' : viewport.assignedView }}</span>
      <span v-if="viewport.assignedView !== 'threeD'" class="text-zinc-300">Slice {{ viewport.sliceIndex }}</span>
    </div>

    <div class="absolute right-2 top-2 z-20">
      <select
        class="rounded-lg border border-zinc-700 bg-zinc-900/75 px-2 py-1 text-[11px] font-medium text-zinc-100 outline-none"
        :value="viewport.assignedView"
        @change="handleViewAssignment"
      >
        <option v-for="view in availableViews" :key="view.key" :value="view.key">{{ view.label }}</option>
      </select>
    </div>

    <canvas
      ref="canvasRef"
      class="h-full w-full touch-none"
      @wheel="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @pointerleave="handlePointerLeave"
    />

    <div v-if="showBrushPreview" class="pointer-events-none absolute z-20 rounded-full border-2" :style="brushPreviewStyle" />

    <div
      v-if="viewport.assignedView !== 'threeD' && isPatientLoaded"
      class="absolute bottom-2 left-2 right-2 z-20 rounded-lg bg-zinc-950/70 px-2 py-1.5 backdrop-blur-sm"
    >
      <input
        type="range"
        class="w-full accent-zinc-200"
        min="0"
        :max="maxSlice"
        :value="viewport.sliceIndex"
        @input="store.setSlice(viewport.id, Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </article>
</template>
