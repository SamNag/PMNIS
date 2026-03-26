<script setup lang="ts">
import { Bot, Check, Columns2, Crosshair, FolderPlus, Pencil, Sparkles, Timer, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'

const store = useViewerStore()
const {
  aiMode,
  aiState,
  aiProgress,
  canRunAi,
  compareOverlay,
  aiDetections,
  selectedDetectionId,
  editingDetectionId,
  aiRunMode,
  aiBoundingBox,
  activeTool,
} = storeToRefs(store)

const hasDetections = computed(() => aiDetections.value.length > 0)
const pendingCount = computed(() => aiDetections.value.filter((d) => d.status === 'pending').length)
const allReviewed = computed(() => hasDetections.value && pendingCount.value === 0)
const acceptedCount = computed(() => aiDetections.value.filter((d) => d.status === 'accepted').length)
const hasBoundingBox = computed(() => !!aiBoundingBox.value)
const isDrawingBox = computed(() => activeTool.value === 'boundingBox')

const confidenceClass = (confidence: number) => {
  if (confidence >= 0.8) return 'text-red-500'
  if (confidence >= 0.6) return 'text-amber-500'
  return 'text-zinc-400'
}
</script>

<template>
  <section class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-panel" data-tutorial="ai-assistant">
    <div class="mb-3 inline-flex items-center gap-2">
      <Bot class="h-4 w-4 text-zinc-500" />
      <h3 class="text-sm font-semibold text-zinc-900">AI Assistant</h3>
    </div>

    <!-- Mode selector -->
    <div class="mb-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-xs font-semibold transition"
        :class="aiMode === 'full' ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'"
        @click="store.setAiMode('full')"
      >
        Fully automatic
      </button>
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-xs font-semibold transition"
        :class="aiMode === 'semi' ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'"
        @click="store.setAiMode('semi')"
      >
        Semi-automatic
      </button>
    </div>

    <p class="mb-3 text-xs text-zinc-500">
      <template v-if="aiMode === 'full'">
        Full mode analyzes the complete scan. You can accept, reject, or refine each finding.
      </template>
      <template v-else>
        Draw a bounding box in one of the views to define the search area, then run AI. You can accept, reject, or refine each finding.
      </template>
    </p>

    <!-- Semi-auto: Draw Area button -->
    <div v-if="aiMode === 'semi'" class="mb-3">
      <button
        type="button"
        class="w-full rounded-lg px-3 py-2 text-xs font-semibold transition"
        :class="isDrawingBox
          ? 'bg-cyan-600 text-white'
          : hasBoundingBox
            ? 'border border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
            : 'border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'"
        @click="store.startBoundingBoxDraw()"
      >
        <Crosshair class="mr-1 inline h-3.5 w-3.5" />
        <template v-if="isDrawingBox">Drawing... click & drag in a view</template>
        <template v-else-if="hasBoundingBox">Area selected — click to redraw</template>
        <template v-else>Draw Area</template>
      </button>
    </div>

    <!-- Run AI -->
    <button
      type="button"
      :disabled="!canRunAi"
      class="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      @click="store.runAi()"
    >
      Run AI
    </button>

    <!-- ====== Detection list ====== -->
    <div v-if="hasDetections" class="mt-3">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Findings ({{ aiDetections.length }})
        </p>
        <span
          v-if="pendingCount > 0"
          class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
        >
          {{ pendingCount }} pending
        </span>
        <span
          v-else
          class="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
        >
          All reviewed
        </span>
      </div>

      <div class="max-h-52 space-y-1 overflow-y-auto">
        <div
          v-for="detection in aiDetections"
          :key="detection.id"
          class="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition cursor-pointer"
          :class="{
            'bg-zinc-100 ring-1 ring-zinc-300': selectedDetectionId === detection.id,
            'hover:bg-zinc-50': selectedDetectionId !== detection.id && detection.status !== 'rejected',
            'opacity-40 line-through': detection.status === 'rejected',
          }"
          @click="detection.status !== 'rejected' && store.selectDetection(detection.id)"
        >
          <!-- Color dot -->
          <span
            class="h-2.5 w-2.5 flex-shrink-0 rounded-full border"
            :style="{ backgroundColor: detection.color, borderColor: detection.color }"
          />

          <!-- Name + label -->
          <div class="flex-1 min-w-0">
            <span class="block truncate font-medium text-zinc-700">{{ detection.name }}</span>
            <span class="text-[10px] text-zinc-400">{{ detection.label }}</span>
          </div>

          <!-- Confidence -->
          <span
            class="flex-shrink-0 text-[11px] font-semibold tabular-nums"
            :class="confidenceClass(detection.confidence)"
          >
            {{ Math.round(detection.confidence * 100) }}%
          </span>

          <!-- Per-detection controls (both modes) -->
          <template v-if="detection.status === 'pending'">
            <button
              class="flex-shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-100 transition"
              title="Accept"
              @click.stop="store.acceptDetection(detection.id)"
            >
              <Check class="h-3.5 w-3.5" />
            </button>
            <button
              class="flex-shrink-0 rounded p-0.5 text-red-500 hover:bg-red-100 transition"
              title="Reject"
              @click.stop="store.rejectDetection(detection.id)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
            <button
              class="flex-shrink-0 rounded p-0.5 transition"
              :class="
                editingDetectionId === detection.id
                  ? 'bg-zinc-900 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-200'
              "
              title="Edit / Refine boundaries"
              @click.stop="store.editDetection(detection.id)"
            >
              <Pencil class="h-3.5 w-3.5" />
            </button>
          </template>

          <template v-else-if="detection.status === 'accepted'">
            <span class="flex-shrink-0 text-emerald-600" title="Accepted">
              <Check class="h-3.5 w-3.5" />
            </span>
            <button
              class="flex-shrink-0 rounded p-0.5 transition"
              :class="
                editingDetectionId === detection.id
                  ? 'bg-zinc-900 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-200'
              "
              title="Edit / Refine boundaries"
              @click.stop="store.editDetection(detection.id)"
            >
              <Pencil class="h-3.5 w-3.5" />
            </button>
          </template>

          <template v-else>
            <span class="flex-shrink-0 text-red-400 text-[10px]">Rejected</span>
          </template>
        </div>
      </div>

      <!-- Bulk actions (while pending exist) -->
      <div v-if="pendingCount > 0" class="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          class="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
          @click="store.acceptAllDetections()"
        >
          Accept All
        </button>
        <button
          type="button"
          class="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600 transition hover:bg-red-100"
          @click="store.rejectAllDetections()"
        >
          Reject All
        </button>
      </div>

      <!-- Create Layer button (when all reviewed) -->
      <button
        v-if="allReviewed"
        type="button"
        class="mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition"
        :class="acceptedCount > 0
          ? 'bg-emerald-600 hover:bg-emerald-700'
          : 'bg-zinc-700 hover:bg-zinc-600'"
        @click="store.finalizeAiResults()"
      >
        <FolderPlus class="mr-1 inline h-3.5 w-3.5" />
        <template v-if="acceptedCount > 0">
          Create Layer ({{ acceptedCount }} accepted)
        </template>
        <template v-else>
          Create Empty Layer
        </template>
      </button>
    </div>

    <!-- Compare overlay -->
    <button
      type="button"
      class="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100"
      :class="compareOverlay ? 'ring-1 ring-zinc-900' : ''"
      @click="store.setCompareOverlay()"
    >
      <Columns2 class="mr-1 inline h-3 w-3" /> Compare Overlay
    </button>

    <!-- Progress bar -->
    <div class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
      <div class="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span class="inline-flex items-center gap-1"><Timer class="h-3 w-3" /> AI progress</span>
        <span>{{ aiProgress }}%</span>
      </div>
      <div class="h-2 rounded-full bg-zinc-200">
        <div
          class="h-2 rounded-full bg-zinc-900 transition-all duration-200"
          :style="{ width: `${aiProgress}%` }"
        />
      </div>
    </div>

    <!-- Clear all results -->
    <button
      v-if="hasDetections"
      type="button"
      :disabled="aiState === 'running'"
      class="mt-2 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
      @click="store.rejectAi()"
    >
      Clear All Results
    </button>

    <!-- Info -->
    <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-2 text-[11px] text-zinc-500">
      <p class="inline-flex items-center gap-1 font-semibold text-zinc-700">
        <Sparkles class="h-3 w-3" /> Simulation Notes
      </p>
      <p class="mt-1">
        <template v-if="aiMode === 'full'">
          Fully automatic mode scans the entire volume. Click a finding to navigate, use controls to accept, reject, or edit, then create a layer.
        </template>
        <template v-else>
          Semi-automatic mode: draw a bounding box first, then run AI. Review each finding, then create a layer with accepted results.
        </template>
      </p>
    </div>
  </section>
</template>
