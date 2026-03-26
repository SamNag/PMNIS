<script setup lang="ts">
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers2, Plus, Trash2 } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'

const store = useViewerStore()
const { annotationLayers, activeLayerId, isPatientLoaded, showTumorMask } = storeToRefs(store)

const formatTimestamp = (ts?: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
      <template v-for="layer in annotationLayers" :key="layer.id">
        <!-- ===== Folder layer ===== -->
        <div v-if="layer.type === 'folder'" class="rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden">
          <!-- Folder header -->
          <div
            class="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-zinc-100 transition"
            @click="store.toggleFolderExpanded(layer.id)"
          >
            <component
              :is="layer.expanded ? ChevronDown : ChevronRight"
              class="h-3.5 w-3.5 flex-shrink-0 text-zinc-400"
            />
            <span class="h-2.5 w-2.5 flex-shrink-0 rounded-full" :style="{ backgroundColor: layer.color }" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-zinc-700">{{ layer.name }}</p>
              <p class="text-[10px] text-zinc-400">
                {{ layer.children?.length ?? 0 }} finding{{ (layer.children?.length ?? 0) !== 1 ? 's' : '' }}
                <span v-if="layer.timestamp" class="ml-1">{{ formatTimestamp(layer.timestamp) }}</span>
              </p>
            </div>
            <div class="ml-auto flex items-center gap-1">
              <button
                type="button"
                class="rounded-md p-1 text-zinc-400 hover:bg-zinc-200 transition"
                @click.stop="store.toggleLayerVisibility(layer.id)"
              >
                <Eye v-if="layer.visible" class="h-3.5 w-3.5" />
                <EyeOff v-else class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="rounded-md p-1 text-red-400 hover:bg-red-50 transition"
                @click.stop="store.deleteLayer(layer.id)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <!-- Folder children -->
          <div v-if="layer.expanded && layer.children?.length" class="border-t border-zinc-200 bg-white">
            <div
              v-for="child in layer.children"
              :key="child.id"
              class="flex items-center justify-between px-3 py-1.5 transition cursor-pointer border-b border-zinc-100 last:border-b-0"
              :class="activeLayerId === child.id
                ? 'bg-zinc-900 text-zinc-50'
                : 'text-zinc-700 hover:bg-zinc-50'"
              @click="store.setActiveLayer(child.id)"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="h-2 w-2 flex-shrink-0 rounded-full" :style="{ backgroundColor: child.color }" />
                <span class="truncate text-[11px] font-medium">{{ child.name }}</span>
              </div>
              <div class="ml-2 flex items-center gap-1">
                <button
                  type="button"
                  class="rounded p-0.5 transition"
                  :class="activeLayerId === child.id ? 'hover:bg-zinc-700' : 'hover:bg-zinc-200'"
                  @click.stop="store.toggleLayerVisibility(child.id)"
                >
                  <Eye v-if="child.visible" class="h-3 w-3" />
                  <EyeOff v-else class="h-3 w-3" />
                </button>
                <button
                  type="button"
                  class="rounded p-0.5 text-red-400 hover:bg-red-50 transition"
                  @click.stop="store.deleteLayer(child.id)"
                >
                  <Trash2 class="h-3 w-3" />
                </button>
              </div>
            </div>

            <!-- Add finding button -->
            <button
              type="button"
              class="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600"
              @click="store.addFindingToFolder(layer.id)"
            >
              <Plus class="h-3 w-3" /> Add Finding
            </button>
          </div>

          <!-- Empty folder -->
          <div v-else-if="layer.expanded && !layer.children?.length" class="border-t border-zinc-200 px-3 py-2">
            <p class="text-[10px] text-zinc-400">No findings yet.</p>
            <button
              type="button"
              class="mt-1 flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-700"
              @click="store.addFindingToFolder(layer.id)"
            >
              <Plus class="h-3 w-3" /> Add Finding
            </button>
          </div>
        </div>

        <!-- ===== Non-folder layer (AI during review, legacy manual) ===== -->
        <div
          v-else
          class="flex items-center justify-between rounded-xl border px-2.5 py-2 transition cursor-pointer"
          :class="activeLayerId === layer.id
            ? 'border-zinc-900 bg-zinc-900 text-zinc-50 shadow-sm'
            : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'"
          @click="store.setActiveLayer(layer.id)"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: layer.color }" />
              <p class="truncate text-xs font-semibold">{{ layer.name }}</p>
            </div>
            <p
              class="mt-0.5 text-[11px] uppercase tracking-wide"
              :class="activeLayerId === layer.id ? 'text-zinc-300' : 'text-zinc-500'"
            >
              {{ layer.type === 'ai' ? 'AI Layer (reviewing)' : 'Manual Layer' }}
            </p>
          </div>
          <div class="ml-2 flex items-center gap-1">
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
      </template>

      <p v-if="!annotationLayers.length" class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-xs text-zinc-500">
        Click "New" to create a session folder, or run AI to detect findings.
      </p>
    </div>
  </section>
</template>
