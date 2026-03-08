<script setup lang="ts">
import { Eye, EyeOff, Trash2 } from 'lucide-vue-next'
import type { AnnotationLayer } from '../types/viewer'

defineProps<{
  layer: AnnotationLayer
  active: boolean
}>()

defineEmits<{
  activate: []
  toggleVisibility: []
  remove: []
}>()
</script>

<template>
  <div
    class="flex items-center justify-between rounded-xl border px-2.5 py-2 transition"
    :class="active ? 'border-zinc-900 bg-zinc-900 text-zinc-50 shadow-sm' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'"
    @click="$emit('activate')"
  >
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: layer.color }" />
        <p class="truncate text-xs font-semibold">{{ layer.name }}</p>
      </div>
      <p class="mt-0.5 text-[11px] uppercase tracking-wide" :class="active ? 'text-zinc-300' : 'text-zinc-500'">
        {{ layer.type === 'ai' ? 'AI Layer' : 'Manual Layer' }}
      </p>
    </div>

    <div class="ml-2 flex items-center gap-1">
      <button
        type="button"
        class="rounded-md p-1.5 transition"
        :class="active ? 'hover:bg-zinc-700' : 'hover:bg-zinc-200'"
        @click.stop="$emit('toggleVisibility')"
      >
        <Eye v-if="layer.visible" class="h-3.5 w-3.5" />
        <EyeOff v-else class="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        class="rounded-md p-1.5 text-red-500 transition hover:bg-red-50"
        @click.stop="$emit('remove')"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
</template>
