<script setup lang="ts">
import { Layers, Upload } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useViewerStore } from '../stores/viewerStore'
import { useAccountStore } from '../stores/accountStore'
import AccountSwitcher from './AccountSwitcher.vue'
import PatientInfoCard from './PatientInfoCard.vue'

defineProps<{
  compact?: boolean
}>()

const store = useViewerStore()
const accountStore = useAccountStore()
const { currentPatient, isPatientLoaded } = storeToRefs(store)
const { isStudent } = storeToRefs(accountStore)

const fileInputRef = ref<HTMLInputElement | null>(null)
const isLoading = ref(false)

const triggerFileUpload = () => {
  fileInputRef.value?.click()
}

const handleLoadDemo = async () => {
  isLoading.value = true
  try {
    if (isStudent.value) {
      await store.loadStudentDemo()
    } else {
      await store.loadPatient()
    }
  } catch (error) {
    console.error('Failed to load demo:', error)
    alert(error instanceof Error ? error.message : 'Failed to load demo scan.')
  } finally {
    isLoading.value = false
  }
}

const handleFileUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  isLoading.value = true
  try {
    await store.loadMedicalPatient(file)
  } catch (error) {
    console.error('Failed to load medical image:', error)
    alert(error instanceof Error ? error.message : 'Failed to load scan.')
  } finally {
    isLoading.value = false
    // Reset input so same file can be selected again
    input.value = ''
  }
}
</script>

<template>
  <!-- Compact header for fullscreen mode - all info inline -->
  <header v-if="compact" class="rounded-xl border border-zinc-200 bg-white/90 shadow-panel">
    <div class="flex items-center gap-2 p-1.5">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:opacity-40"
        :disabled="isLoading"
        @click="handleLoadDemo"
      >
        <Layers class="h-3 w-3" />
        {{ isLoading ? '...' : 'Data' }}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-50"
        :disabled="isLoading"
        @click="triggerFileUpload"
      >
        <Upload class="h-3 w-3" />
        {{ isLoading ? '...' : 'Upload' }}
      </button>
      <input
        ref="fileInputRef"
        type="file"
        accept=".nii,.nii.gz,.dcm,.dicom,application/dicom"
        class="hidden"
        @change="handleFileUpload"
      />
      <!-- Patient info inline with separators -->
      <template v-if="isPatientLoaded && currentPatient">
        <span class="mx-1 h-4 w-px bg-zinc-300" />
        <span class="text-[11px] font-semibold text-zinc-800">{{ currentPatient.name }}</span>
        <span class="text-[10px] text-zinc-400">•</span>
        <span class="text-[10px] text-zinc-500">ID: {{ currentPatient.id }}</span>
        <span class="text-[10px] text-zinc-400">•</span>
        <span class="text-[10px] text-zinc-500">{{ currentPatient.studyType }}</span>
        <span class="text-[10px] text-zinc-400">•</span>
        <span class="text-[10px] text-zinc-500">{{ currentPatient.scanDate }}</span>
        <span class="text-[10px] text-zinc-400">•</span>
        <span class="text-[10px] text-zinc-500">Age: {{ currentPatient.age }}</span>
      </template>
      <span class="flex-1" />
      <AccountSwitcher compact />
    </div>
  </header>

  <!-- Normal full header -->
  <header v-else class="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-panel">
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-3" data-tutorial="header-buttons">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:opacity-40"
          :disabled="isLoading"
          @click="handleLoadDemo"
        >
          <Layers class="h-4 w-4" />
          {{ isLoading ? 'Loading...' : 'Load data' }}
        </button>
        <button
        type="button"
        class="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
        :disabled="isLoading"
        @click="triggerFileUpload"
      >
        <Upload class="h-4 w-4" />
        {{ isLoading ? 'Loading...' : 'Upload Scan' }}
      </button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".nii,.nii.gz,.dcm,.dicom,application/dicom"
          class="hidden"
          @change="handleFileUpload"
        />
        <p class="text-xs text-zinc-500">local NIfTI or DICOM volume</p>
      </div>
      <span class="flex-1" />
      <AccountSwitcher />
    </div>

    <div v-if="isPatientLoaded && currentPatient" class="mt-3">
      <PatientInfoCard :patient="currentPatient" />
    </div>
  </header>
</template>
