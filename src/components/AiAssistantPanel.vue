<script setup lang="ts">
import { BookOpen, Bot, Check, CircleHelp, Crosshair, Pencil, Timer, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import { useAccountStore } from '../stores/accountStore'
import { educationalDescriptions } from '../data/educationalContent'
import type { AiDetection } from '../types/viewer'

const store = useViewerStore()
const accountStore = useAccountStore()
const {
  aiMode,
  aiState,
  aiProgress,
  canRunAi,
  aiDetections,
  selectedDetectionId,
  editingDetectionId,
  aiBoundingBox,
  activeTool,
} = storeToRefs(store)
const { isStudent } = storeToRefs(accountStore)

const eduDetectionId = ref<string | null>(null)
const eduDetection = computed(() =>
  eduDetectionId.value ? aiDetections.value.find((d) => d.id === eduDetectionId.value) ?? null : null,
)
const eduContent = computed(() =>
  eduDetection.value ? (educationalDescriptions[eduDetection.value.label] ?? null) : null,
)

function openEduPopup(detectionId: string) {
  eduDetectionId.value = detectionId
}

function closeEduPopup() {
  eduDetectionId.value = null
}

function getEduContent(label: string) {
  return educationalDescriptions[label] ?? null
}

const hasDetections = computed(() => aiDetections.value.length > 0)
const pendingCount = computed(() => aiDetections.value.filter((d) => d.status === 'pending').length)
const hasBoundingBox = computed(() => !!aiBoundingBox.value)
const isDrawingBox = computed(() => activeTool.value === 'boundingBox')
const openInfoDetectionId = ref<string | null>(null)
const infoDetection = computed(
  () => aiDetections.value.find((d) => d.id === openInfoDetectionId.value) ?? null,
)

const confidenceStyle = (confidence: number) => {
  const percent = Math.round(confidence * 100)
  const hue = percent <= 50
    ? (percent / 50) * 28
    : 28 + ((percent - 50) / 50) * (120 - 28)

  return {
    color: `hsl(${hue}, 78%, 36%)`,
    backgroundColor: `hsla(${hue}, 90%, 52%, 0.14)`,
    borderColor: `hsla(${hue}, 78%, 42%, 0.35)`,
  }
}

const openConfidencePopup = (detectionId: string) => {
  openInfoDetectionId.value = detectionId
}

const closeConfidencePopup = () => {
  openInfoDetectionId.value = null
}

const confidenceLevel = (detection: AiDetection) => {
  if (detection.confidenceLabel?.trim()) return `${detection.confidenceLabel} confidence`

  const percent = Math.round(detection.confidence * 100)
  if (percent >= 95) return 'Very high confidence'
  if (percent >= 90) return 'High confidence'
  if (percent >= 85) return 'Strong confidence'
  return 'Review-ready confidence'
}

const confidenceSummary = (detection: AiDetection) => {
  const percent = Math.round(detection.confidence * 100)

  if (percent >= 95) {
    return 'This finding stands out clearly from nearby tissue and keeps a stable shape across neighboring slices.'
  }

  if (percent >= 90) {
    return 'This finding has strong local contrast and a compact mask shape that stays consistent around the detected center.'
  }

  return 'This finding remains above the review threshold because the region is coherent, localized, and persistent across adjacent slices.'
}

const confidenceReason = (detection: AiDetection) =>
  detection.confidenceReason?.trim()
    || `This region stands out because signal contrast, contour continuity, and slice-to-slice consistency remain strong near (${Math.round(detection.centerX)}, ${Math.round(detection.centerY)}, ${Math.round(detection.centerZ)}).`

const confidenceNote = (detection: AiDetection) => `This mask is currently interpreted as a ${detection.label.toLowerCase()} candidate with an estimated radius of about ${Math.max(1, Math.round(detection.radius))} px. If the borders do not match the anatomy, refine the region directly with the brush and eraser tools.`
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
      <template v-if="isStudent && aiMode === 'full'">
        Full mode analyzes the complete scan automatically. Review each finding below to practice your diagnostic skills.
      </template>
      <template v-else-if="isStudent && aiMode === 'semi'">
        Draw a bounding box to guide the AI to a specific region. This helps you practice focused examination of suspicious areas.
      </template>
      <template v-else-if="aiMode === 'full'">
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

    <!-- Run segmentation -->
    <button
      type="button"
      :disabled="!canRunAi"
      class="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
      @click="store.runAi()"
    >
      Run segmentation
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

      <div class="max-h-64 space-y-1 overflow-y-auto">
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
            class="flex-shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            :style="confidenceStyle(detection.confidence)"
          >
            {{ Math.round(detection.confidence * 100) }}%
          </span>
          <button
            type="button"
            class="flex-shrink-0 rounded-full border border-zinc-200 bg-white/90 p-1 text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-700"
            title="Open confidence details"
            @click.stop="openConfidencePopup(detection.id)"
          >
            <CircleHelp class="h-3.5 w-3.5" />
          </button>

          <div class="flex items-center gap-1">
            <button
              class="flex-shrink-0 rounded p-0.5 transition"
              :class="
                editingDetectionId === detection.id
                  ? 'bg-zinc-900 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-200'
              "
              title="Adjust mask"
              @click.stop="store.editDetection(detection.id)"
            >
              <Pencil class="h-3.5 w-3.5" />
            </button>
            <button
              v-if="isStudent && getEduContent(detection.label)"
              class="flex-shrink-0 rounded p-0.5 text-violet-500 transition hover:bg-violet-50 hover:text-violet-600"
              title="Learn more"
              @click.stop="openEduPopup(detection.id)"
            >
              <BookOpen class="h-3.5 w-3.5" />
            </button>
            <button
              class="flex-shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-100 transition"
              title="Accept and create layer"
              @click.stop="store.acceptDetection(detection.id)"
            >
              <Check class="h-3.5 w-3.5" />
            </button>
            <button
              class="flex-shrink-0 rounded p-0.5 text-red-500 hover:bg-red-100 transition"
              title="Delete result"
              @click.stop="store.rejectDetection(detection.id)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

      </div>
    </div>

    <!-- Progress bar -->
    <div v-if="aiState === 'running' || hasDetections" class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
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
  </section>

  <div
    v-if="infoDetection"
    class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 px-4"
    @click.self="closeConfidencePopup()"
  >
    <div class="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-zinc-900">{{ infoDetection.name }}</p>
          <p class="mt-1 text-xs text-zinc-500">
            {{ infoDetection.label }} • {{ Math.round(infoDetection.confidence * 100) }}% confidence
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          @click="closeConfidencePopup()"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <div class="flex items-center gap-2">
          <span
            class="rounded-full border px-2 py-1 text-xs font-semibold tabular-nums"
            :style="confidenceStyle(infoDetection.confidence)"
          >
            {{ confidenceLevel(infoDetection) }}
          </span>
        </div>
        <p class="mt-2 text-xs leading-5 text-zinc-600">{{ confidenceSummary(infoDetection) }}</p>
      </div>

      <div class="mt-3 space-y-2 text-xs leading-5 text-zinc-600">
        <div class="rounded-xl border border-zinc-200 bg-white p-3">
          <p class="font-semibold text-zinc-800">Why this stands out</p>
          <p class="mt-1">{{ confidenceReason(infoDetection) }}</p>
        </div>
        <div class="rounded-xl border border-zinc-200 bg-white p-3">
          <p class="font-semibold text-zinc-800">Interpretation notes</p>
          <p class="mt-1">{{ confidenceNote(infoDetection) }}</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Educational popup (student only, separate from confidence) -->
  <div
    v-if="eduDetection && eduContent"
    class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 px-4"
    @click.self="closeEduPopup()"
  >
    <div class="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-zinc-900">{{ eduDetection.name }}</p>
          <p class="mt-0.5 text-xs text-zinc-500">Educational reference</p>
        </div>
        <button
          type="button"
          class="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          @click="closeEduPopup()"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
        <p class="mb-2 text-xs font-semibold text-violet-800">{{ eduContent.title }}</p>
        <div class="space-y-2 text-xs leading-5 text-zinc-600">
          <div class="rounded-xl border border-violet-100 bg-white p-3">
            <p class="font-semibold text-violet-700">Pathology</p>
            <p class="mt-1">{{ eduContent.pathology }}</p>
          </div>
          <div class="rounded-xl border border-violet-100 bg-white p-3">
            <p class="font-semibold text-violet-700">Imaging Features</p>
            <p class="mt-1">{{ eduContent.imagingFeatures }}</p>
          </div>
          <div class="rounded-xl border border-violet-100 bg-white p-3">
            <p class="font-semibold text-violet-700">Clinical Context</p>
            <p class="mt-1">{{ eduContent.clinicalContext }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
