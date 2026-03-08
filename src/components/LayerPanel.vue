<script setup lang="ts">
import { Layers2, Plus } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import LayerItem from './LayerItem.vue'

const store = useViewerStore()
const { annotationLayers, activeLayerId, isPatientLoaded, showTumorMask } = storeToRefs(store)
</script>

<template>
  <section class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-panel">
    <div class="mb-3 flex items-center justify-between">
      <div class="inline-flex items-center gap-2">
        <Layers2 class="h-4 w-4 text-zinc-500" />
        <h3 class="text-sm font-semibold text-zinc-900">Annotation Layers</h3>
      </div>
      <button
        type="button"
        :disabled="!isPatientLoaded"
        class="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.createManualLayer()"
      >
        <Plus class="h-3.5 w-3.5" />
        New
      </button>
    </div>

    <div class="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2">
      <label class="flex cursor-pointer items-center justify-between text-xs font-medium text-zinc-700">
        <span>Tumor mask overlay</span>
        <input v-model="showTumorMask" type="checkbox" class="h-4 w-4 rounded border-zinc-300 text-zinc-900" />
      </label>
    </div>

    <div class="space-y-2">
      <LayerItem
        v-for="layer in annotationLayers"
        :key="layer.id"
        :layer="layer"
        :active="activeLayerId === layer.id"
        @activate="store.setActiveLayer(layer.id)"
        @toggle-visibility="store.toggleLayerVisibility(layer.id)"
        @remove="store.deleteLayer(layer.id)"
      />
      <p v-if="!annotationLayers.length" class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-xs text-zinc-500">
        Create a manual layer before drawing or running AI segmentation.
      </p>
    </div>
  </section>
</template>
