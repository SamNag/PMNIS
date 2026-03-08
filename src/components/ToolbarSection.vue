<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <section class="space-y-2">
    <p class="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400 md:text-center">{{ title }}</p>
    <div class="flex flex-col items-center gap-2">
      <slot />
    </div>
  </section>
</template>
