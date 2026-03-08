<script setup lang="ts">
import type { Patient } from '../types/viewer'

defineProps<{
  patient: Patient
}>()
</script>

<template>
  <div class="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs text-zinc-600 shadow-sm sm:grid-cols-3">
    <div>
      <p class="font-semibold uppercase tracking-wide text-zinc-500">Patient</p>
      <p class="text-sm font-semibold text-zinc-900">{{ patient.name }}</p>
      <p>ID: {{ patient.id }}</p>
    </div>
    <div>
      <p class="font-semibold uppercase tracking-wide text-zinc-500">Exam</p>
      <p>{{ patient.studyType }}</p>
      <p>Date: {{ patient.scanDate }}</p>
    </div>
    <div>
      <p class="font-semibold uppercase tracking-wide text-zinc-500">Demographics</p>
      <p>Age: {{ patient.age }}</p>
      <p>Status: Simulated dataset</p>
    </div>
  </div>
</template>
