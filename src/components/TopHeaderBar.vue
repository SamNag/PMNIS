<script setup lang="ts">
import { Layers } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useViewerStore } from '../stores/viewerStore'
import PatientInfoCard from './PatientInfoCard.vue'

const store = useViewerStore()
const { currentPatient, isPatientLoaded } = storeToRefs(store)
</script>

<template>
  <header class="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-panel">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800"
          @click="store.loadPatient()"
        >
          <Layers class="h-4 w-4" />
          Load Patient
        </button>
        <p class="text-xs text-zinc-500">
          <span class="font-semibold text-zinc-700">Frontend-only prototype</span>
          · local MRI volume + tumor mask
        </p>
      </div>
    </div>

    <div v-if="isPatientLoaded && currentPatient" class="mt-3">
      <PatientInfoCard :patient="currentPatient" />
    </div>
  </header>
</template>
