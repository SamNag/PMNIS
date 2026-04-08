<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppShell from './components/AppShell.vue'
import WizardPanel from './components/WizardPanel.vue'
import { useViewerStore } from './stores/viewerStore'

const isWizard = ref(false)

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  if (params.has('wizard')) {
    isWizard.value = true
  } else {
    // Participant mode: enable WoZ listener so wizard can inject detections
    const store = useViewerStore()
    store.enableWoz()
  }
})
</script>

<template>
  <WizardPanel v-if="isWizard" />
  <AppShell v-else />
</template>
