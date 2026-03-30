<script setup lang="ts">
import { Check, Eye, EyeOff, Layers2, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import { layerColorOptions } from '../lib/layerColors'
import { useViewerStore } from '../stores/viewerStore'
import type { AnnotationLayer } from '../types/viewer'

const store = useViewerStore()
const { annotationLayers, activeLayerId, isPatientLoaded } = storeToRefs(store)
const editingLayerId = ref<string | null>(null)
const editingName = ref('')
const editingNameInput = ref<HTMLInputElement | null>(null)
const colorPickerLayerId = ref<string | null>(null)
const displayLayers = computed(() => {
  const result: AnnotationLayer[] = []
  for (const layer of annotationLayers.value) {
    if (layer.type === 'folder') {
      if (layer.children?.length) {
        result.push(...layer.children.filter((child) => child.type !== 'ai'))
      }
      continue
    }
    if (layer.type === 'ai') {
      continue
    }
    result.push(layer)
  }
  return result
})

const isEditingLayer = (layerId: string) => editingLayerId.value === layerId

const startRename = async (layer: AnnotationLayer) => {
  editingLayerId.value = layer.id
  editingName.value = layer.name
  await nextTick()
  editingNameInput.value?.focus()
  editingNameInput.value?.select()
}

const cancelRename = () => {
  editingLayerId.value = null
  editingName.value = ''
}

const toggleColorPicker = (layerId: string) => {
  colorPickerLayerId.value = colorPickerLayerId.value === layerId ? null : layerId
}

const pickLayerColor = (layerId: string, color: string) => {
  store.setLayerColor(layerId, color)
  colorPickerLayerId.value = null
}

const commitRename = () => {
  if (!editingLayerId.value) return
  const trimmed = editingName.value.trim()
  if (trimmed) {
    store.renameLayer(editingLayerId.value, trimmed)
  }
  cancelRename()
}
</script>

<template>
  <section class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-panel" data-tutorial="layer-panel">
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
        New Layer
      </button>
    </div>
    <div class="max-h-[21rem] space-y-2 overflow-y-auto pr-1">
      <template v-for="layer in displayLayers" :key="layer.id">
        <div
          class="rounded-xl border transition"
          :class="activeLayerId === layer.id
            ? 'border-zinc-900 bg-zinc-900 text-zinc-50 shadow-sm'
            : 'border-zinc-200 bg-white text-zinc-700'"
        >
          <div
            class="flex items-center justify-between rounded-xl px-2.5 py-2 transition cursor-pointer"
            :class="activeLayerId === layer.id ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'"
            @click="!isEditingLayer(layer.id) && store.setActiveLayer(layer.id)"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="h-3.5 w-3.5 rounded-full border border-white/40 shadow-sm transition hover:scale-105"
                  :style="{ backgroundColor: layer.color }"
                  title="Change layer color"
                  @click.stop="toggleColorPicker(layer.id)"
                />
                <input
                  v-if="isEditingLayer(layer.id)"
                  ref="editingNameInput"
                  v-model="editingName"
                  type="text"
                  class="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 outline-none ring-0 focus:border-zinc-400"
                  @click.stop
                  @blur="commitRename()"
                  @keydown.enter.prevent.stop="commitRename()"
                  @keydown.esc.prevent.stop="cancelRename()"
                >
                <p v-else class="truncate text-xs font-semibold">{{ layer.name }}</p>
              </div>
              <p
                class="mt-0.5 text-[11px] uppercase tracking-wide"
                :class="activeLayerId === layer.id ? 'text-zinc-300' : 'text-zinc-500'"
              >
                {{ layer.type === 'ai' ? 'AI Layer (reviewing)' : 'Tumor Layer' }}
              </p>
            </div>
            <div class="ml-2 flex items-center gap-1">
              <button
                type="button"
                class="rounded-md p-1.5 transition"
                :class="activeLayerId === layer.id ? 'hover:bg-zinc-700' : 'hover:bg-zinc-200'"
                title="Rename layer"
                @mousedown.prevent.stop="isEditingLayer(layer.id) ? commitRename() : startRename(layer)"
              >
                <Pencil v-if="!isEditingLayer(layer.id)" class="h-3.5 w-3.5" />
                <Check v-else class="h-3.5 w-3.5 text-emerald-600" />
              </button>
              <button
                v-if="isEditingLayer(layer.id)"
                type="button"
                class="rounded-md p-1.5 transition"
                :class="activeLayerId === layer.id ? 'hover:bg-zinc-700' : 'hover:bg-zinc-200'"
                title="Cancel rename"
                @mousedown.prevent.stop="cancelRename()"
              >
                <X class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="rounded-md p-1.5 transition"
                :class="activeLayerId === layer.id ? 'hover:bg-zinc-700' : 'hover:bg-zinc-200'"
                @click.stop="store.toggleLayerVisibility(layer.id)"
              >
                <Eye v-if="layer.visible" class="h-3.5 w-3.5" />
                <EyeOff v-else class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="rounded-md p-1.5 text-red-500 transition hover:bg-red-50"
                @click.stop="store.deleteLayer(layer.id)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div
            v-if="colorPickerLayerId === layer.id"
            class="border-t border-zinc-200/80 px-2.5 py-2"
            :class="activeLayerId === layer.id ? 'bg-zinc-800' : 'bg-zinc-50'"
          >
            <p
              class="mb-2 text-[10px] font-semibold uppercase tracking-wide"
              :class="activeLayerId === layer.id ? 'text-zinc-300' : 'text-zinc-500'"
            >
              Layer Color
            </p>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="option in layerColorOptions"
                :key="option.value"
                type="button"
                class="flex h-8 items-center justify-center rounded-lg border transition hover:scale-[1.02]"
                :class="layer.color === option.value
                  ? 'border-white/80 ring-2 ring-white/40'
                  : activeLayerId === layer.id
                    ? 'border-zinc-600'
                    : 'border-zinc-200'"
                :style="{ backgroundColor: option.value }"
                :title="option.name"
                @click.stop="pickLayerColor(layer.id, option.value)"
              />
            </div>
          </div>
        </div>
      </template>

      <p v-if="!displayLayers.length" class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-xs text-zinc-500">
        Click "New Layer" to create a tumor layer. Accepted results appear here automatically.
      </p>
    </div>
  </section>
</template>
