<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import EmptyState from './EmptyState.vue'
import ViewerPanel from './ViewerPanel.vue'

const store = useViewerStore()
const { isPatientLoaded, layout, visibleViewports } = storeToRefs(store)

const gridClass = computed(() => {
  if (layout.value === '3x1') return 'lg:grid-cols-3 lg:grid-rows-1'
  return 'grid-cols-1 grid-rows-1'
})
</script>

<template>
  <section
    class="h-full min-h-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-500 shadow-panel"
    data-tutorial="viewer-grid"
  >
    <EmptyState v-if="!isPatientLoaded" />

    <div v-else class="grid h-full min-h-0 grid-cols-1 grid-rows-1 gap-[1px]" :class="gridClass">
      <ViewerPanel
        v-for="viewport in visibleViewports"
        :key="viewport.id"
        :viewport="viewport"
        class="h-full min-h-0"
      />
    </div>
  </section>
</template>

