<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import EmptyState from './EmptyState.vue'
import ViewerPanel from './ViewerPanel.vue'

const store = useViewerStore()
const { isPatientLoaded, layout, visibleViewports, isFullscreenMode, fullscreenViewportState } = storeToRefs(store)

const gridClass = computed(() => {
  if (layout.value === '2x2') return 'sm:grid-cols-2 sm:grid-rows-2'
  if (layout.value === '3x1') return 'lg:grid-cols-3 lg:grid-rows-1'
  return 'grid-cols-1 grid-rows-1'
})
</script>

<template>
  <section
    class="h-full min-h-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100/55 p-3 shadow-panel"
  >
    <EmptyState v-if="!isPatientLoaded" />

    <!-- Fullscreen Mode -->
    <div v-else-if="isFullscreenMode && fullscreenViewportState" class="h-full min-h-0">
      <ViewerPanel :viewport="fullscreenViewportState" :is-fullscreen="true" class="h-full min-h-0" />
    </div>

    <!-- Normal Grid Mode -->
    <div v-else class="grid h-full min-h-0 grid-cols-1 grid-rows-1 gap-3" :class="gridClass">
      <ViewerPanel v-for="viewport in visibleViewports" :key="viewport.id" :viewport="viewport" class="h-full min-h-0" />
    </div>
  </section>
</template>



