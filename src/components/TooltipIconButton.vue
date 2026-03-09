<script setup lang="ts">
import type { FunctionalComponent, SVGAttributes } from 'vue'

defineProps<{
  icon: FunctionalComponent<SVGAttributes>
  label: string
  active?: boolean
  disabled?: boolean
  variant?: 'default' | 'danger'
}>()

defineEmits<{
  click: []
}>()
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :aria-label="label"
    :title="label"
    class="group relative z-10 aspect-square w-10 shrink-0 rounded-xl border text-zinc-600 transition-all duration-200"
    :class="[
      variant === 'danger' && active
        ? 'border-red-500 bg-red-500 text-white shadow-panel hover:bg-red-600'
        : active
          ? 'border-zinc-900 bg-zinc-900 text-zinc-50 shadow-panel'
          : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50',
      disabled ? 'cursor-not-allowed opacity-45' : '',
    ]"
    @click="$emit('click')"
  >
    <component :is="icon" class="mx-auto h-4 w-4" />
    <span
      class="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-[120] -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 opacity-0 shadow-panel transition group-hover:opacity-100 group-focus-visible:opacity-100 md:bottom-auto md:left-[calc(100%+10px)] md:top-1/2 md:-translate-y-1/2 md:translate-x-0"
    >
      {{ label }}
    </span>
  </button>
</template>
