<script setup lang="ts">
import AiAssistantPanel from './AiAssistantPanel.vue'
import LayoutPanel from './LayoutPanel.vue'
import LayerPanel from './LayerPanel.vue'
import LeftToolbar from './LeftToolbar.vue'
import TopHeaderBar from './TopHeaderBar.vue'
import ToolbarCategoryPanel from './ToolbarCategoryPanel.vue'
import ViewerGrid from './ViewerGrid.vue'
</script>

<template>
  <div class="min-h-screen p-3 sm:p-4 lg:p-5">
    <div class="w-full">
      <div class="flex flex-col gap-3 md:flex-row">
        <div class="relative z-[210] space-y-3 md:sticky md:top-4">
          <ToolbarCategoryPanel />
          <LeftToolbar />
        </div>

        <main class="min-w-0 flex-1 space-y-3">
          <TopHeaderBar />
          <ViewerGrid />
        </main>

        <aside class="w-full space-y-3 md:w-[320px] lg:w-[340px]">
          <LayoutPanel />
          <LayerPanel />
          <AiAssistantPanel />
        </aside>
      </div>
    </div>
  </div>
</template>
