<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import type { ToolbarSection } from '../types/viewer'

const store = useViewerStore()
const { activeToolbarSection } = storeToRefs(store)

const categories: Array<{ key: ToolbarSection; label: string }> = [
  { key: 'image', label: 'IMG' },
  { key: 'manual', label: 'DRAW' },
  { key: 'ai', label: 'AI' },
]
</script>

<template>
  <aside class="w-full rounded-2xl border border-zinc-200 bg-zinc-50/70 p-2.5 shadow-panel md:w-[92px]" data-tutorial="toolbar-categories">
    <div class="space-y-2">
      <button
        v-for="item in categories"
        :key="item.key"
        type="button"
        class="inline-flex w-full items-center justify-start gap-2 rounded-lg border px-2 py-2 text-xs font-semibold transition"
        :class="
          activeToolbarSection === item.key
            ? 'border-zinc-900 bg-zinc-900 text-zinc-100'
            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
        "
        :title="item.label"
        @click="store.setActiveToolbarSection(item.key)"
      >
        <span class="w-full text-center tracking-wide">{{ item.label }}</span>
      </button>
    </div>
  </aside>
</template>
