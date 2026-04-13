<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Eye } from 'lucide-vue-next'
import { useViewerStore } from '../stores/viewerStore'
import type { ViewType, ViewportState } from '../types/viewer'
import { slicePointToVolume } from '../lib/annotations'
import { fitCanvasToDevicePixelRatio, renderSlice, screenToSlice, type RenderTransform } from '../lib/rendering'
import { renderThreeDVolume, destroyThreeDVolume } from '../lib/rendering3d'
import { getSliceSize, getViewMaxSlice } from '../lib/volume'

const props = defineProps<{
  viewport: ViewportState
  isThumbnail?: boolean
}>()

const store = useViewerStore()
const {
  volumeData,
  activeViewportId,
  viewports,
  layout,
  renderSettings,
  annotationLayers,
  annotationVersion,
  annotationPreviewVersion,
  isPatientLoaded,
  brushSize,
  activeTool,
  activeLayer,
  canAnnotate,
  aiBoundingBox,
} = storeToRefs(store)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvas3DRef = ref<HTMLCanvasElement | null>(null)
const panelRef = ref<HTMLDivElement | null>(null)
const animationFrame = ref<number | null>(null)
const pendingDrawFrame = ref<number | null>(null)
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
/** Temporary bounding box while the user is dragging. */
const drawingBox = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
let resizeObserver: ResizeObserver | null = null

// Single-view 3D clip slider state
const fsClipAxial = ref(0)
const fsClipCoronal = ref(0)
const fsClipSagittal = ref(0)

const maxAxialSlice = computed(() => volumeData.value ? volumeData.value.depth - 1 : 0)
const maxCoronalSlice = computed(() => volumeData.value ? volumeData.value.height - 1 : 0)
const maxSagittalSlice = computed(() => volumeData.value ? volumeData.value.width - 1 : 0)

// Show clip sliders only when the user is focused on a single viewport.
const showClipSliders = computed(() => layout.value === 'single')

const clip3D = computed(() => {
  if (!volumeData.value) return { x: 1, y: 1, z: 1 }

  if (showClipSliders.value && props.viewport.assignedView === 'threeD') {
    return {
      x: (fsClipSagittal.value + 1) / volumeData.value.width,
      y: (fsClipCoronal.value + 1) / volumeData.value.height,
      z: (fsClipAxial.value + 1) / volumeData.value.depth,
    }
  }

  // Multi-viewport mode: read clip positions from other viewports
  const vps = viewports.value
  const axialVp = vps.find(vp => vp.assignedView === 'axial')
  const coronalVp = vps.find(vp => vp.assignedView === 'coronal')
  const sagittalVp = vps.find(vp => vp.assignedView === 'sagittal')

  return {
    x: sagittalVp ? (sagittalVp.sliceIndex + 1) / volumeData.value.width : 1,
    y: coronalVp ? (coronalVp.sliceIndex + 1) / volumeData.value.height : 1,
    z: axialVp ? (axialVp.sliceIndex + 1) / volumeData.value.depth : 1,
  }
})

const isActive = computed(() => activeViewportId.value === props.viewport.id)

const availableViews: Array<{ key: ViewType; label: string }> = [
  { key: 'axial', label: 'Axial' },
  { key: 'sagittal', label: 'Sagittal' },
  { key: 'coronal', label: 'Coronal' },
  { key: 'threeD', label: '3D' },
]

/** Flatten folder children so the renderer sees individual layers. */
const visibleLayers = computed(() => {
  const result: typeof annotationLayers.value = []
  for (const layer of annotationLayers.value) {
    if (layer.type === 'folder') {
      if (layer.visible && layer.children) {
        for (const child of layer.children) {
          result.push(child)
        }
      }
    } else {
      result.push(layer)
    }
  }
  return result
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

const isToolPreviewViewport = computed(
  () =>
    props.viewport.assignedView !== 'threeD' &&
    activeViewportId.value === props.viewport.id,
)

const showBrushPreview = computed(
  () =>
    !!cursorPoint.value &&
    canAnnotate.value &&
    (activeTool.value === 'brush' || activeTool.value === 'eraser') &&
    isToolPreviewViewport.value,
)

const hideNativeCursor = computed(
  () =>
    ((activeTool.value === 'brush' || activeTool.value === 'eraser') && canAnnotate.value ||
     activeTool.value === 'boundingBox') &&
    isToolPreviewViewport.value,
)

const canvasCursorClass = computed(() => {
  if (activeTool.value === 'boundingBox' && props.viewport.assignedView !== 'threeD') return 'cursor-crosshair'
  if (hideNativeCursor.value) return 'cursor-none'
  return ''
})

const toolPreviewStyle = computed(() => {
  if (!cursorPoint.value || !showBrushPreview.value) return {}
  const isEraser = activeTool.value === 'eraser'
  const color = isEraser ? '#ef4444' : (activeLayer.value?.color ?? '#f97316')
  const radius = previewRadiusPx.value
  return {
    left: `${cursorPoint.value.x}px`,
    top: `${cursorPoint.value.y}px`,
    transform: 'translate(-50%, -50%)',
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
    borderRadius: '9999px',
    borderWidth: '2px',
    borderStyle: 'solid' as const,
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
    false,
    false,
  )

  // Render bounding box overlay
  const box = drawingBox.value ?? (
    aiBoundingBox.value && aiBoundingBox.value.view === props.viewport.assignedView
      ? aiBoundingBox.value
      : null
  )
  if (box && volumeData.value) {
    const ctx = canvasRef.value.getContext('2d')
    if (ctx) {
      const t = transformRef.value
      const { width: sw, height: sh } = getSliceSize(
        props.viewport.assignedView as Exclude<ViewType, 'threeD'>,
        volumeData.value,
      )
      const cx1 = t.drawX + (Math.min(box.x1, box.x2) / sw) * t.drawW
      const cy1 = t.drawY + (Math.min(box.y1, box.y2) / sh) * t.drawH
      const cx2 = t.drawX + (Math.max(box.x1, box.x2) / sw) * t.drawW
      const cy2 = t.drawY + (Math.max(box.y1, box.y2) / sh) * t.drawH
      const bw = cx2 - cx1
      const bh = cy2 - cy1

      // Dim area outside the box
      const dx = t.drawX, dy = t.drawY, dw = t.drawW, dh = t.drawH
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(dx, dy, dw, cy1 - dy)                       // top strip
      ctx.fillRect(dx, cy2, dw, dy + dh - cy2)                 // bottom strip
      ctx.fillRect(dx, cy1, cx1 - dx, bh)                      // left strip
      ctx.fillRect(cx2, cy1, dx + dw - cx2, bh)                // right strip

      // Bright solid border
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 2.5
      ctx.setLineDash([])
      ctx.strokeRect(cx1, cy1, bw, bh)

      // Corner brackets
      const cornerLen = Math.min(14, bw * 0.25, bh * 0.25)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(cx1, cy1 + cornerLen); ctx.lineTo(cx1, cy1); ctx.lineTo(cx1 + cornerLen, cy1)
      ctx.moveTo(cx2 - cornerLen, cy1); ctx.lineTo(cx2, cy1); ctx.lineTo(cx2, cy1 + cornerLen)
      ctx.moveTo(cx1, cy2 - cornerLen); ctx.lineTo(cx1, cy2); ctx.lineTo(cx1 + cornerLen, cy2)
      ctx.moveTo(cx2 - cornerLen, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2 - cornerLen)
      ctx.stroke()

      // Label
      ctx.font = '11px sans-serif'
      ctx.fillStyle = '#22d3ee'
      ctx.fillText('AI Search Area', cx1 + 4, cy1 - 5)
    }
  }

}

const draw3D = () => {
  if (!canvas3DRef.value || !volumeData.value || props.viewport.assignedView !== 'threeD') return
  const { x: clipX, y: clipY, z: clipZ } = clip3D.value
  renderThreeDVolume(
    canvas3DRef.value,
    volumeData.value,
    angleYRef.value,
    angleXRef.value,
    zoom3DRef.value,
    pan3DXRef.value,
    pan3DYRef.value,
    clipX,
    clipY,
    clipZ,
    visibleLayers.value,
    false,
    `${annotationVersion.value}:${annotationPreviewVersion.value}`,
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
    pan3DYRef.value -= deltaY
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

/** Coalesces multiple draw requests into a single requestAnimationFrame. */
const scheduleDraw = () => {
  if (pendingDrawFrame.value !== null) return
  pendingDrawFrame.value = window.requestAnimationFrame(() => {
    pendingDrawFrame.value = null
    draw()
  })
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
  store.updateSlice(props.viewport.id, delta)
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
  cursorPoint.value = pointer ? { x: event.clientX, y: event.clientY } : null

  if (!pointer || !canAnnotate.value || props.viewport.assignedView === 'threeD') return

  const radius = getAnnotationRadius()
  const view = props.viewport.assignedView as Exclude<ViewType, 'threeD'>
  const volumePoint = slicePointToVolume(view, props.viewport.sliceIndex, pointer.mappedX, pointer.mappedY)
  const lastPoint = lastDrawnPoint.value

  store.syncSlicesToVolumePoint(volumePoint.x, volumePoint.y, volumePoint.z)

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

  // Bounding box tool
  if (activeTool.value === 'boundingBox' && event.button === 0) {
    const pointer = mapPointerToSlice(event)
    if (pointer) {
      drawingBox.value = { x1: pointer.mappedX, y1: pointer.mappedY, x2: pointer.mappedX, y2: pointer.mappedY }
      isDrawing.value = true
      canvasRef.value?.setPointerCapture(event.pointerId)
    }
    return
  }

  // Left button with annotation tools
  if (!canAnnotate.value || !canvasRef.value) return

  store.beginManualEdit()
  isDrawing.value = true
  lastDrawnPoint.value = null
  canvasRef.value.setPointerCapture(event.pointerId)
  drawAtPointer(event)
  scheduleDraw()
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

  // Handle bounding box drawing
  if (activeTool.value === 'boundingBox' && isDrawing.value && drawingBox.value) {
    const pointer = mapPointerToSlice(event)
    if (pointer) {
      drawingBox.value.x2 = pointer.mappedX
      drawingBox.value.y2 = pointer.mappedY
      scheduleDraw()
    }
    return
  }

  const pointer = mapPointerToSlice(event)
  cursorPoint.value = pointer ? { x: event.clientX, y: event.clientY } : null
  if (!isDrawing.value) return
  drawAtPointer(event)
  // During active drawing, schedule redraw directly (annotationVersion not bumped until stroke end)
  scheduleDraw()
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

  // Finalize bounding box
  if (activeTool.value === 'boundingBox' && isDrawing.value && drawingBox.value) {
    const view = props.viewport.assignedView as Exclude<ViewType, 'threeD'>
    store.setBoundingBox({
      view,
      slice: props.viewport.sliceIndex,
      x1: Math.min(drawingBox.value.x1, drawingBox.value.x2),
      y1: Math.min(drawingBox.value.y1, drawingBox.value.y2),
      x2: Math.max(drawingBox.value.x1, drawingBox.value.x2),
      y2: Math.max(drawingBox.value.y1, drawingBox.value.y2),
    })
    drawingBox.value = null
    isDrawing.value = false
    if (canvasRef.value?.hasPointerCapture(event.pointerId)) {
      canvasRef.value.releasePointerCapture(event.pointerId)
    }
    scheduleDraw()
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
  store.assignViewToViewport(props.viewport.id, view)
}

onMounted(() => {
  draw()
  if (panelRef.value) {
    resizeObserver = new ResizeObserver(() => scheduleDraw())
    resizeObserver.observe(panelRef.value)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver && panelRef.value) resizeObserver.unobserve(panelRef.value)
  if (animationFrame.value) window.cancelAnimationFrame(animationFrame.value)
  if (pendingDrawFrame.value !== null) window.cancelAnimationFrame(pendingDrawFrame.value)
  if (canvas3DRef.value) destroyThreeDVolume(canvas3DRef.value)
  releaseDrawing()
})

// Shallow watch on annotationVersion replaces the expensive deep watch on annotationLayers.
// renderSettings still needs deep: true (it's a small 8-field object).
watch(annotationVersion, () => scheduleDraw())
watch(annotationPreviewVersion, () => scheduleDraw())
watch(
  [
    () => props.viewport.assignedView,
    () => props.viewport.sliceIndex,
    volumeData,
    renderSettings,
    clip3D,
    aiBoundingBox,
  ],
  () => scheduleDraw(),
  { deep: true },
)

// In single-layout 3D, default to the fully open volume so the whole brain is visible.
watch(
  [showClipSliders, () => props.viewport.assignedView, volumeData],
  ([show, assignedView, volume]) => {
    if (show && assignedView === 'threeD' && volume) {
      fsClipAxial.value = maxAxialSlice.value
      fsClipCoronal.value = maxCoronalSlice.value
      fsClipSagittal.value = maxSagittalSlice.value
    }
  },
  { immediate: true },
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
    class="relative h-full min-h-0 overflow-hidden bg-zinc-900 transition"
    :class="isActive ? 'ring-2 ring-zinc-300 ring-inset' : ''"
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
      :class="canvasCursorClass"
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

    <!-- Tool cursor preview (teleported to body so it's never clipped by overflow-hidden) -->
    <Teleport to="body">
      <div
        v-if="showBrushPreview"
        class="pointer-events-none fixed z-[9999]"
        :style="toolPreviewStyle"
      />
    </Teleport>

    <!-- 3D hint text -->
    <div
      v-if="viewport.assignedView === 'threeD' && isPatientLoaded && !isThumbnail && !showClipSliders"
      class="pointer-events-none absolute bottom-2 left-2 z-20 text-[11px] text-zinc-400/60"
    >
      Drag to pan · Right-click to rotate · Scroll to zoom
    </div>

    <!-- 3D clip sliders (fullscreen or single view) -->
    <div
      v-if="viewport.assignedView === 'threeD' && isPatientLoaded && !isThumbnail && showClipSliders"
      class="absolute bottom-3 left-3 right-3 z-20 ml-auto flex max-w-sm flex-col gap-1.5 rounded-lg bg-zinc-950/70 px-3 py-2 backdrop-blur-sm"
    >
      <div class="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-2">
        <span class="text-[10px] font-medium text-zinc-300">Axial</span>
        <input type="range" class="min-w-0 w-full accent-zinc-200" min="0" :max="maxAxialSlice" :value="fsClipAxial" @input="fsClipAxial = Number(($event.target as HTMLInputElement).value)" />
        <span class="text-right text-[10px] tabular-nums text-zinc-400">{{ fsClipAxial }}</span>
      </div>
      <div class="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-2">
        <span class="text-[10px] font-medium text-zinc-300">Coronal</span>
        <input type="range" class="min-w-0 w-full accent-zinc-200" min="0" :max="maxCoronalSlice" :value="fsClipCoronal" @input="fsClipCoronal = Number(($event.target as HTMLInputElement).value)" />
        <span class="text-right text-[10px] tabular-nums text-zinc-400">{{ fsClipCoronal }}</span>
      </div>
      <div class="grid grid-cols-[4.75rem_minmax(0,1fr)_3rem] items-center gap-2">
        <span class="text-[10px] font-medium text-zinc-300">Sagittal</span>
        <input type="range" class="min-w-0 w-full accent-zinc-200" min="0" :max="maxSagittalSlice" :value="fsClipSagittal" @input="fsClipSagittal = Number(($event.target as HTMLInputElement).value)" />
        <span class="text-right text-[10px] tabular-nums text-zinc-400">{{ fsClipSagittal }}</span>
      </div>
      <div class="pointer-events-none text-[9px] text-zinc-500">Drag to pan · Right-click to rotate · Scroll to zoom</div>
    </div>

    <!-- 2D slice slider -->
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
        @input="store.setSlice(viewport.id, Number(($event.target as HTMLInputElement).value))"
      />
    </div>
  </article>
</template>
