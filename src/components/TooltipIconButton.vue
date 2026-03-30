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
    class="z-10 aspect-square w-10 shrink-0 rounded-xl border text-zinc-600 transition-all duration-200"
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
  </button>
</template>
