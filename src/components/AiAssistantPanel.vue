<script setup lang="ts">
import { Bot, Check, Columns2, Pencil, Sparkles, Timer, X } from 'lucide-vue-next'
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'

const store = useViewerStore()
const {
  aiMode,
  aiState,
  aiProgress,
  canRunAi,
  selectedLayerHasSelection,
  compareOverlay,
  aiDetections,
  selectedDetectionId,
  editingDetectionId,
  aiRunMode,
} = storeToRefs(store)

const hasDetections = computed(() => aiDetections.value.length > 0)
const pendingCount = computed(() => aiDetections.value.filter((d) => d.status === 'pending').length)
/** Semi-auto run → user can accept/reject/edit each detection. */
const isSemiResult = computed(() => aiRunMode.value === 'semi')

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
        Full mode analyzes the complete scan. Results are final and cannot be edited.
      </template>
      <template v-else>
        Semi mode detects suspicious areas for review. You can accept, reject, or refine each finding by drawing in all three axes.
        <span :class="selectedLayerHasSelection ? 'text-emerald-600' : 'text-amber-600'">
          {{ selectedLayerHasSelection ? 'Selection detected.' : 'Draw a region first.' }}
        </span>
      </template>
    </p>

    <!-- Run / Refine -->
    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        :disabled="!canRunAi"
        class="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.runAi('run')"
      >
        Run AI
      </button>
      <button
        type="button"
        :disabled="!canRunAi"
        class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.runAi('refine')"
      >
        Refine result
      </button>
    </div>

    <!-- ====== Detection list ====== -->
    <div v-if="hasDetections" class="mt-3">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Findings ({{ aiDetections.length }})
        </p>
        <span
          v-if="isSemiResult && pendingCount > 0"
          class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
        >
          {{ pendingCount }} pending
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

          <!-- ======= Semi-auto controls per detection ======= -->
          <template v-if="isSemiResult">
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
          </template>
          <!-- Full-auto: no per-detection actions (navigation only) -->
        </div>
      </div>

      <!-- Semi-auto bulk actions -->
      <div v-if="isSemiResult && pendingCount > 0" class="mt-2 grid grid-cols-2 gap-2">
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
          Fully automatic mode produces final contour results. Click a finding to navigate across all views.
        </template>
        <template v-else>
          Semi-automatic mode identifies suspicious areas for review. Click a finding to navigate, then use the pencil icon to refine boundaries with brush/eraser in any axis.
        </template>
      </p>
    </div>
  </section>
</template>
