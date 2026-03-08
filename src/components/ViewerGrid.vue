<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import EmptyState from './EmptyState.vue'
import ViewerPanel from './ViewerPanel.vue'

const store = useViewerStore()
const { isPatientLoaded, layout, visibleViewports } = storeToRefs(store)

const gridClass = computed(() => {
  if (layout.value === '2x2') return 'grid-cols-1 sm:grid-cols-2 sm:grid-rows-2'
  if (layout.value === '3x1') return 'grid-cols-1 lg:grid-cols-3 lg:auto-rows-fr'
  return 'grid-cols-1'
})

const sectionClass = computed(() => {
  if (layout.value === '3x1') return 'min-h-[360px]'
  return 'min-h-[600px]'
})
</script>

<template>
  <section class="rounded-2xl border border-zinc-200 bg-zinc-100/55 p-3 shadow-panel" :class="sectionClass">
    <EmptyState v-if="!isPatientLoaded" />

    <div v-else class="grid h-full gap-3" :class="gridClass">
      <ViewerPanel v-for="viewport in visibleViewports" :key="viewport.id" :viewport="viewport" />
    </div>
  </section>
</template>
