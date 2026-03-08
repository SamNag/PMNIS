<script setup lang="ts">
import { Bot, Sparkles, Timer } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'

const store = useViewerStore()
const { aiMode, aiState, aiProgress, canRunAi, selectedLayerHasSelection, compareOverlay } = storeToRefs(store)
</script>

<template>
  <section class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-panel">
    <div class="mb-3 inline-flex items-center gap-2">
      <Bot class="h-4 w-4 text-zinc-500" />
      <h3 class="text-sm font-semibold text-zinc-900">AI Assistant (Mock)</h3>
    </div>

    <div class="mb-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-xs font-semibold transition"
        :class="aiMode === 'full' ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'"
        @click="store.setAiMode('full')"
      >
        Fully automatic
      </button>
      <button
        type="button"
        class="rounded-lg px-3 py-2 text-xs font-semibold transition"
        :class="aiMode === 'semi' ? 'bg-zinc-900 text-zinc-100' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'"
        @click="store.setAiMode('semi')"
      >
        Semi-automatic
      </button>
    </div>

    <p class="mb-3 text-xs text-zinc-500">
      <template v-if="aiMode === 'full'">Full mode analyzes the complete scan and creates an AI layer.</template>
      <template v-else>
        Semi mode requires a selected region in the active manual layer.
        <span :class="selectedLayerHasSelection ? 'text-emerald-600' : 'text-amber-600'">
          {{ selectedLayerHasSelection ? 'Selection detected.' : 'Selection missing.' }}
        </span>
      </template>
    </p>

    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        :disabled="!canRunAi"
        class="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.runAi('run')"
      >
        Run AI
      </button>
      <button
        type="button"
        :disabled="!canRunAi"
        class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.runAi('refine')"
      >
        Refine result
      </button>
      <button
        type="button"
        :disabled="aiState !== 'success'"
        class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.acceptAi()"
      >
        Accept
      </button>
      <button
        type="button"
        :disabled="aiState === 'running'"
        class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        @click="store.rejectAi()"
      >
        Reject
      </button>
    </div>

    <button
      type="button"
      class="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100"
      :class="compareOverlay ? 'ring-1 ring-zinc-900' : ''"
      @click="store.setCompareOverlay()"
    >
      Compare Overlay
    </button>

    <div class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
      <div class="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span class="inline-flex items-center gap-1"><Timer class="h-3 w-3" /> AI progress</span>
        <span>{{ aiProgress }}%</span>
      </div>
      <div class="h-2 rounded-full bg-zinc-200">
        <div class="h-2 rounded-full bg-zinc-900 transition-all duration-200" :style="{ width: `${aiProgress}%` }" />
      </div>
    </div>

    <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-2 text-[11px] text-zinc-500">
      <p class="inline-flex items-center gap-1 font-semibold text-zinc-700"><Sparkles class="h-3 w-3" /> Simulation Notes</p>
      <p class="mt-1">AI behavior is mocked locally for demo realism. No external model or backend call is used.</p>
    </div>
  </section>
</template>
