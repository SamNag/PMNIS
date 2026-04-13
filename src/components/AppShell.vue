<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useViewerStore } from '../stores/viewerStore'
import { sendParticipantMessage } from '../lib/wizardChannel'
import AiAssistantPanel from './AiAssistantPanel.vue'
import LayoutPanel from './LayoutPanel.vue'
import LayerPanel from './LayerPanel.vue'
import LeftToolbar from './LeftToolbar.vue'
import OnboardingTutorial from './OnboardingTutorial.vue'
import TopHeaderBar from './TopHeaderBar.vue'
import ToolbarCategoryPanel from './ToolbarCategoryPanel.vue'
import ViewerGrid from './ViewerGrid.vue'

const store = useViewerStore()
const {
  isFullscreenMode,
  wozEnabled,
  aiState,
  aiMode,
  aiProgress,
  aiBoundingBox,
  isPatientLoaded,
  volumeData,
  renderSettings,
  taskRatingQuestion,
  taskRatingVisible,
} = storeToRefs(store)

// Send status updates to the wizard when relevant state changes
watch(
  [aiState, aiMode, aiProgress, aiBoundingBox, isPatientLoaded, renderSettings, () => store.activeViewport?.assignedView, () => store.activeViewport?.sliceIndex],
  () => {
    if (!wozEnabled.value) return
    const vol = volumeData.value
    const rs = renderSettings.value
    sendParticipantMessage({
      type: 'status-update',
      aiState: aiState.value,
      aiMode: aiMode.value,
      aiProgress: aiProgress.value,
      boundingBox: aiBoundingBox.value,
      activeView: store.activeViewport?.assignedView ?? 'axial',
      sliceIndex: store.activeViewport?.sliceIndex ?? 0,
      patientLoaded: isPatientLoaded.value,
      volumeDims: vol ? { width: vol.width, height: vol.height, depth: vol.depth } : null,
      renderSettings: rs ? { windowCenter: rs.windowCenter, windowWidth: rs.windowWidth, contrast: rs.contrast, threshold: rs.threshold, inverted: rs.inverted } : null,
      flipCorSag: !!(vol?.flipCorSag),
    })
  },
  { immediate: true, deep: true },
)

const isSidebarOpen = ref(true)
const showTutorial = ref(!sessionStorage.getItem('pmnis-tutorial-seen'))

watch(isFullscreenMode, (next, previous) => {
  if (next && !previous) {
    isSidebarOpen.value = false
  }
})

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const handleBackdropClick = () => {
  if (isSidebarOpen.value) {
    isSidebarOpen.value = false
  }
}

const closeTutorial = () => {
  showTutorial.value = false
  sessionStorage.setItem('pmnis-tutorial-seen', '1')
}
</script>

<template>
  <div class="h-screen w-full overflow-hidden p-3 sm:p-4 lg:p-5">
    <div class="h-full w-full">
      <div class="flex h-full min-h-0 flex-col gap-3 md:flex-row">
        <div class="relative z-[210] shrink-0 space-y-3">
          <ToolbarCategoryPanel />
          <LeftToolbar />
        </div>

        <main class="min-w-0 flex min-h-0 flex-1 flex-col gap-3" :class="isFullscreenMode ? 'pr-10' : ''">
          <TopHeaderBar :compact="isFullscreenMode" />
          <ViewerGrid class="min-h-0 flex-1" />
        </main>

        <!-- Click-outside backdrop for closing sidebar -->
        <div
          v-if="isFullscreenMode && isSidebarOpen"
          class="fixed inset-0 z-[190]"
          @click="handleBackdropClick"
        />

        <!-- Collapsible Sidebar for Fullscreen Mode -->
        <aside
          v-if="isFullscreenMode"
          class="fixed right-0 top-0 z-[200] flex h-full transition-transform duration-300"
          :class="isSidebarOpen ? 'translate-x-0' : 'translate-x-[calc(100%-40px)]'"
        >
          <!-- Toggle Button -->
          <button
            type="button"
            class="flex h-20 w-10 items-center justify-center self-center rounded-l-xl border-2 border-r-0 shadow-xl transition"
            :class="isSidebarOpen
              ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
              : 'border-white bg-white text-zinc-900 hover:bg-zinc-100'"
            @click.stop="toggleSidebar"
          >
            <component :is="isSidebarOpen ? ChevronRight : ChevronLeft" class="h-6 w-6" />
          </button>

          <!-- Sidebar Content -->
          <div
            class="h-full w-[280px] space-y-3 overflow-y-auto rounded-l-2xl border-l border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur lg:w-[300px]"
            @click.stop
          >
            <LayoutPanel />
            <LayerPanel />
            <AiAssistantPanel />
          </div>
        </aside>

        <!-- Normal Sidebar -->
        <aside v-else class="h-full w-full shrink-0 space-y-3 overflow-y-auto md:w-[320px] lg:w-[340px]">
          <LayoutPanel />
          <LayerPanel />
          <AiAssistantPanel />
        </aside>
      </div>
    </div>

    <!-- Onboarding tutorial overlay -->
    <Teleport to="body">
      <div
        v-if="taskRatingVisible"
        class="fixed inset-0 z-[400] flex items-center justify-center bg-zinc-950/45 px-4"
      >
        <div class="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl">
          <p class="text-center text-lg font-semibold text-zinc-900">{{ taskRatingQuestion }}</p>
          <p class="mt-2 text-center text-sm text-zinc-500">Tap one number from 1 to 5.</p>
          <div class="mt-3 flex items-center justify-between text-xs font-medium text-zinc-500">
            <span>1 = Very easy</span>
            <span>5 = Very difficult</span>
          </div>
          <div class="mt-5 grid grid-cols-5 gap-3">
            <button
              v-for="item in [
                { value: 1, label: 'Very easy' },
                { value: 2, label: 'Easy' },
                { value: 3, label: 'Medium' },
                { value: 4, label: 'Hard' },
                { value: 5, label: 'Very difficult' },
              ]"
              :key="item.value"
              type="button"
              class="rounded-2xl border border-zinc-200 bg-zinc-50 px-2 py-4 text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-100"
              @click="store.closeTaskRatingPrompt(item.value)"
            >
              <span class="block text-lg font-bold">{{ item.value }}</span>
              <span class="mt-1 block text-[11px] font-medium leading-tight text-zinc-500">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <OnboardingTutorial v-if="showTutorial" @close="closeTutorial" />
    </Teleport>
  </div>
</template>
