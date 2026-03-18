<script setup lang="ts">
import { Columns3, LayoutGrid, Square } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import type { LayoutMode } from '../types/viewer'

const store = useViewerStore()
const { layout } = storeToRefs(store)

const setLayout = (mode: LayoutMode) => store.setLayout(mode)

const layoutItems: Array<{ key: LayoutMode; label: string; icon: typeof LayoutGrid }> = [
  { key: '2x2', label: '2 x 2', icon: LayoutGrid },
  { key: '3x1', label: '3 x 1', icon: Columns3 },
  { key: 'single', label: 'Single', icon: Square },
]
</script>

<template>
  <section class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-panel" data-tutorial="layout-panel">
    <h3 class="mb-3 text-sm font-semibold text-zinc-900">Layout</h3>

    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="item in layoutItems"
        :key="item.key"
        type="button"
        class="inline-flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition"
        :class="
          layout === item.key
            ? 'border-zinc-900 bg-zinc-900 text-zinc-100 shadow-sm'
            : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
        "
        :title="`${item.label} layout`"
        @click="setLayout(item.key)"
      >
        <component :is="item.icon" class="h-4 w-4" />
        {{ item.label }}
      </button>
    </div>
  </section>
</template>
