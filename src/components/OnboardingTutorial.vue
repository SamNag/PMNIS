<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-vue-next'

const emit = defineEmits<{
  close: []
}>()

interface TutorialStep {
  target: string
  title: string
  description: string
  preferredPosition: 'right' | 'left' | 'bottom' | 'top'
}

const steps: TutorialStep[] = [
  {
    target: 'header-buttons',
    title: 'Load MRI Data',
    description:
      'Start by loading a demo scan to explore the app, or upload your own NIfTI MRI file (.nii or .nii.gz).',
    preferredPosition: 'bottom',
  },
  {
    target: 'toolbar-categories',
    title: 'Toolbar Sections',
    description:
      'Switch between Image adjustments (IMG), Manual drawing tools (DRAW), and AI-powered segmentation (AI).',
    preferredPosition: 'right',
  },
  {
    target: 'left-toolbar',
    title: 'Tool Controls',
    description:
      'Use zoom and pan for navigation. Below, find section-specific tools like brightness controls, brush/eraser, or AI commands.',
    preferredPosition: 'right',
  },
  {
    target: 'viewer-grid',
    title: 'MRI Viewer',
    description:
      'View brain MRI slices across multiple orientations — axial, sagittal, coronal, and 3D volume. Scroll to navigate through slices.',
    preferredPosition: 'bottom',
  },
  {
    target: 'layout-panel',
    title: 'Layout Options',
    description:
      'Choose your preferred viewport arrangement: 2×2 grid, 3×1 row, or a single enlarged view for detailed inspection.',
    preferredPosition: 'left',
  },
  {
    target: 'layer-panel',
    title: 'Annotation Layers',
    description:
      'Create manual annotation layers, toggle tumor mask visibility, and manage multiple segmentation overlays.',
    preferredPosition: 'left',
  },
  {
    target: 'ai-assistant',
    title: 'AI Assistant',
    description:
      'Run AI tumor segmentation in fully automatic or semi-automatic mode. Review findings, adjust confidence thresholds, and accept or reject results.',
    preferredPosition: 'left',
  },
  {
    target: 'fullscreen-toggle',
    title: 'Fullscreen & Reset',
    description:
      'Enter fullscreen mode for a focused single-viewport experience. Use reset to restore default view settings.',
    preferredPosition: 'right',
  },
]

const currentStep = ref(0)
const highlightRect = ref<DOMRect | null>(null)

const isFirst = computed(() => currentStep.value === 0)
const isLast = computed(() => currentStep.value === steps.length - 1)
const step = computed(() => steps[currentStep.value])
const stepLabel = computed(() => `${currentStep.value + 1} / ${steps.length}`)

const updateHighlight = () => {
  const el = document.querySelector(`[data-tutorial="${step.value.target}"]`)
  if (el) {
    highlightRect.value = el.getBoundingClientRect()
  } else {
    highlightRect.value = null
  }
}

const next = () => {
  if (!isLast.value) {
    currentStep.value++
  }
}

const prev = () => {
  if (!isFirst.value) {
    currentStep.value--
  }
}

const close = () => {
  emit('close')
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') close()
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (isLast.value) close()
    else next()
  }
  if (e.key === 'ArrowLeft') prev()
}

const highlightStyle = computed(() => {
  if (!highlightRect.value) return { display: 'none' }

  const rect = highlightRect.value
  const pad = 8

  return {
    position: 'fixed' as const,
    left: `${rect.left - pad}px`,
    top: `${rect.top - pad}px`,
    width: `${rect.width + pad * 2}px`,
    height: `${rect.height + pad * 2}px`,
    borderRadius: '16px',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
    pointerEvents: 'none' as const,
    transition: 'all 0.3s ease-in-out',
  }
})

const tooltipStyle = computed(() => {
  if (!highlightRect.value) return { display: 'none' }

  const rect = highlightRect.value
  const gap = 16
  const tw = 300 // tooltip width
  const th = 190 // tooltip approximate height
  const pad = 8
  const margin = 16 // minimum distance from viewport edges
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Available space in each direction (from the padded highlight edge)
  const spaceRight = vw - (rect.right + pad + gap)
  const spaceLeft = rect.left - pad - gap
  const spaceBottom = vh - (rect.bottom + pad + gap)
  const spaceTop = rect.top - pad - gap

  // Pick the best position: try preferred first, then fallback
  let pos = step.value.preferredPosition
  const fits = (p: string) => {
    if (p === 'right') return spaceRight >= tw + margin
    if (p === 'left') return spaceLeft >= tw + margin
    if (p === 'bottom') return spaceBottom >= th + margin
    if (p === 'top') return spaceTop >= th + margin
    return false
  }

  if (!fits(pos)) {
    const fallbacks: Array<'right' | 'left' | 'bottom' | 'top'> = ['bottom', 'right', 'left', 'top']
    pos = fallbacks.find(fits) ?? 'bottom'
  }

  const style: Record<string, string> = {
    position: 'fixed',
    width: `${tw}px`,
    transition: 'all 0.3s ease-in-out',
  }

  if (pos === 'right') {
    style.left = `${rect.right + pad + gap}px`
    const centerY = rect.top + rect.height / 2 - th / 2
    style.top = `${Math.max(margin, Math.min(centerY, vh - th - margin))}px`
  } else if (pos === 'left') {
    style.left = `${rect.left - pad - gap - tw}px`
    const centerY = rect.top + rect.height / 2 - th / 2
    style.top = `${Math.max(margin, Math.min(centerY, vh - th - margin))}px`
  } else if (pos === 'bottom') {
    const centerX = rect.left + rect.width / 2 - tw / 2
    style.left = `${Math.max(margin, Math.min(centerX, vw - tw - margin))}px`
    style.top = `${rect.bottom + pad + gap}px`
  } else if (pos === 'top') {
    const centerX = rect.left + rect.width / 2 - tw / 2
    style.left = `${Math.max(margin, Math.min(centerX, vw - tw - margin))}px`
    style.top = `${rect.top - pad - gap - th}px`
  }

  return style
})

watch(currentStep, () => {
  nextTick(updateHighlight)
})

onMounted(() => {
  updateHighlight()
  window.addEventListener('resize', updateHighlight)
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateHighlight)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <!-- Click blocker overlay (invisible, blocks all interaction with app) -->
  <div class="fixed inset-0 z-[10000]" />

  <!-- Highlight cutout with box-shadow dimming -->
  <div :style="highlightStyle" class="z-[10001]" />

  <!-- Close button (X) — top right corner -->
  <button
    type="button"
    class="fixed right-5 top-5 z-[10003] flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow-lg backdrop-blur-sm transition hover:bg-white hover:text-zinc-900"
    @click="close"
    title="Close tutorial"
  >
    <X class="h-5 w-5" />
  </button>

  <!-- Tooltip bubble -->
  <div
    :style="tooltipStyle"
    class="z-[10002] rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
    @click.stop
  >
    <!-- Step counter -->
    <div class="mb-2 text-xs font-semibold text-zinc-400">{{ stepLabel }}</div>

    <!-- Title -->
    <h4 class="mb-1.5 text-sm font-bold text-zinc-900">{{ step.title }}</h4>

    <!-- Description -->
    <p class="mb-4 text-xs leading-relaxed text-zinc-600">{{ step.description }}</p>

    <!-- Navigation buttons -->
    <div class="flex items-center justify-between gap-2">
      <button
        v-if="!isFirst"
        type="button"
        class="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
        @click="prev"
      >
        <ChevronLeft class="h-3.5 w-3.5" />
        Previous
      </button>
      <span v-else />

      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
        :class="
          isLast
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : 'bg-zinc-900 text-zinc-100 hover:bg-zinc-800'
        "
        @click="isLast ? close() : next()"
      >
        <template v-if="isLast">
          <Check class="h-3.5 w-3.5" />
          Done
        </template>
        <template v-else>
          Next
          <ChevronRight class="h-3.5 w-3.5" />
        </template>
      </button>
    </div>
  </div>
</template>
