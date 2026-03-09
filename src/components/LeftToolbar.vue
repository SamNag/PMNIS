<script setup lang="ts">
import {
  Bot,
  Brain,
  Brush,
  Check,
  Columns2,
  Contrast,
  Eraser,
  Hand,
  Maximize2,
  Play,
  Redo2,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  SunMedium,
  Trash2,
  Undo2,
  Wand,
  X,
  ZoomIn,
} from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useViewerStore } from '../stores/viewerStore'
import type { ToolId } from '../types/viewer'
import ToolbarSectionComponent from './ToolbarSection.vue'
import TooltipIconButton from './TooltipIconButton.vue'

const store = useViewerStore()
const {
  activeTool,
  activeToolbarSection,
  isPatientLoaded,
  activeLayerId,
  aiMode,
  canRunAi,
  aiState,
  compareOverlay,
  renderSettings,
  brushSize,
  canUndoManual,
  canRedoManual,
  isFullscreenMode,
} = storeToRefs(store)

const selectTool = (tool: ToolId, section: 'image' | 'manual' | 'ai') => store.setActiveTool(tool, section)

type AdjustControl = 'brightness' | 'contrast' | 'threshold'
type OverlayMode = 'size' | 'adjust' | null

const activeAdjustControl = ref<AdjustControl>('brightness')
const overlayMode = ref<OverlayMode>(null)

const isManualReady = computed(() => !!activeLayerId.value && isPatientLoaded.value)

const adjustControlConfig = computed(() => {
  if (activeAdjustControl.value === 'brightness') {
    return {
      label: 'Brightness',
      valueText: `${Math.round(renderSettings.value.windowCenter)}`,
      min: 20,
      max: 220,
      step: 1,
      value: renderSettings.value.windowCenter,
    }
  }

  if (activeAdjustControl.value === 'contrast') {
    return {
      label: 'Contrast',
      valueText: renderSettings.value.contrast.toFixed(2),
      min: 0.4,
      max: 2.4,
      step: 0.05,
      value: renderSettings.value.contrast,
    }
  }

  return {
    label: 'Threshold',
    valueText: `${Math.round(renderSettings.value.threshold)}`,
    min: 0,
    max: 255,
    step: 1,
    value: renderSettings.value.threshold,
  }
})

const openManualTool = (tool: 'brush' | 'eraser') => {
  // Toggle the overlay if clicking the same tool that's already active
  if (overlayMode.value === 'size' && activeTool.value === tool) {
    overlayMode.value = null
    return
  }
  selectTool(tool, 'manual')
  overlayMode.value = 'size'
}

const openAdjustControl = (control: AdjustControl) => {
  // Toggle off if clicking the same control
  if (overlayMode.value === 'adjust' && activeAdjustControl.value === control) {
    overlayMode.value = null
    return
  }
  activeAdjustControl.value = control
  overlayMode.value = 'adjust'
}

const closeOverlay = () => {
  overlayMode.value = null
}

const updateAdjustValue = (value: number) => {
  if (activeAdjustControl.value === 'brightness') {
    store.setWindowCenter(value)
    return
  }

  if (activeAdjustControl.value === 'contrast') {
    store.setContrast(value)
    return
  }

  store.setThreshold(value)
}

watch(activeToolbarSection, () => {
  overlayMode.value = null
})
</script>

<template>
  <aside class="relative z-[220] w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 p-2.5 shadow-panel md:w-[92px]">
    <div class="space-y-2.5 overflow-visible">
      <ToolbarSectionComponent v-if="activeToolbarSection === 'image'" title="Image">
        <TooltipIconButton :icon="ZoomIn" label="Zoom" :active="activeTool === 'zoom'" @click="selectTool('zoom', 'image')" />
        <TooltipIconButton :icon="Hand" label="Pan" :active="activeTool === 'pan'" @click="selectTool('pan', 'image')" />

        <!-- Divider after Zoom/Pan -->
        <div class="my-1 h-px w-full bg-zinc-200" />

        <TooltipIconButton
          :icon="SunMedium"
          label="Brightness"
          :active="overlayMode === 'adjust' && activeAdjustControl === 'brightness'"
          :disabled="!isPatientLoaded"
          @click="openAdjustControl('brightness')"
        />
        <TooltipIconButton
          :icon="Contrast"
          label="Contrast"
          :active="overlayMode === 'adjust' && activeAdjustControl === 'contrast'"
          :disabled="!isPatientLoaded"
          @click="openAdjustControl('contrast')"
        />
        <TooltipIconButton
          :icon="SlidersHorizontal"
          label="Threshold"
          :active="overlayMode === 'adjust' && activeAdjustControl === 'threshold'"
          :disabled="!isPatientLoaded"
          @click="openAdjustControl('threshold')"
        />
        <TooltipIconButton :icon="ScanLine" label="Invert" @click="selectTool('invert', 'image')" />

        <!-- Divider before Fit/Reset -->
        <div class="my-1 h-px w-full bg-zinc-200" />

        <TooltipIconButton
          :icon="isFullscreenMode ? X : Maximize2"
          :label="isFullscreenMode ? 'Exit fullscreen' : 'Fullscreen'"
          :active="isFullscreenMode"
          :variant="isFullscreenMode ? 'danger' : 'default'"
          @click="store.toggleFullscreenMode()"
        />
        <TooltipIconButton :icon="RotateCcw" label="Reset view" @click="selectTool('reset', 'image')" />
      </ToolbarSectionComponent>

      <ToolbarSectionComponent v-else-if="activeToolbarSection === 'manual'" title="Manual">
        <TooltipIconButton
          :icon="Brush"
          label="Brush"
          :active="activeTool === 'brush'"
          :disabled="!isManualReady"
          @click="openManualTool('brush')"
        />
        <TooltipIconButton
          :icon="Eraser"
          label="Rubber"
          :active="activeTool === 'eraser'"
          :disabled="!isManualReady"
          @click="openManualTool('eraser')"
        />
        <TooltipIconButton :icon="Undo2" label="Step back" :disabled="!canUndoManual" @click="store.undoManualEdit()" />
        <TooltipIconButton :icon="Redo2" label="Step front" :disabled="!canRedoManual" @click="store.redoManualEdit()" />
        <TooltipIconButton :icon="Trash2" label="Reset full" :disabled="!isManualReady" @click="store.resetActiveManualLayer()" />
      </ToolbarSectionComponent>

      <ToolbarSectionComponent v-else-if="activeToolbarSection === 'ai'" title="AI">
        <TooltipIconButton
          :icon="Bot"
          label="Fully automatic"
          :active="aiMode === 'full'"
          :disabled="!isPatientLoaded"
          @click="store.setAiMode('full')"
        />
        <TooltipIconButton
          :icon="Brain"
          label="Semi-automatic"
          :active="aiMode === 'semi'"
          :disabled="!isPatientLoaded"
          @click="store.setAiMode('semi')"
        />
        <TooltipIconButton
          :icon="Play"
          label="Run AI"
          :disabled="!canRunAi"
          :active="aiState === 'running'"
          @click="store.runAi('run')"
        />
        <TooltipIconButton :icon="Wand" label="Refine result" :disabled="!canRunAi" @click="store.runAi('refine')" />
        <TooltipIconButton :icon="Check" label="Accept result" :disabled="aiState !== 'success'" @click="store.acceptAi()" />
        <TooltipIconButton :icon="X" label="Reject result" :disabled="aiState === 'running'" @click="store.rejectAi()" />
        <TooltipIconButton
          :icon="Columns2"
          label="Compare overlay"
          :disabled="!isPatientLoaded"
          :active="compareOverlay"
          @click="store.setCompareOverlay()"
        />
      </ToolbarSectionComponent>

    </div>

    <div
      v-if="overlayMode"
      class="absolute left-[calc(100%+10px)] top-1 z-[9999] w-44 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-2xl max-md:left-1/2 max-md:top-[calc(100%+8px)] max-md:-translate-x-1/2"
    >
      <button type="button" class="mb-2 w-full rounded-lg border border-zinc-200 px-2 py-1 text-[10px] font-semibold text-zinc-600" @click="closeOverlay">
        Close
      </button>

      <template v-if="overlayMode === 'size'">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Size {{ brushSize }}</p>
        <input
          type="range"
          min="2"
          max="24"
          step="1"
          :disabled="!isManualReady"
          :value="brushSize"
          class="mt-1 w-full accent-zinc-900"
          @input="store.setBrushSize(Number(($event.target as HTMLInputElement).value))"
        />
      </template>

      <template v-else>
        <p class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          {{ adjustControlConfig.label }} {{ adjustControlConfig.valueText }}
        </p>
        <input
          type="range"
          :min="adjustControlConfig.min"
          :max="adjustControlConfig.max"
          :step="adjustControlConfig.step"
          :disabled="!isPatientLoaded"
          :value="adjustControlConfig.value"
          class="mt-1 w-full accent-zinc-900"
          @input="updateAdjustValue(Number(($event.target as HTMLInputElement).value))"
        />
      </template>
    </div>
  </aside>
</template>
