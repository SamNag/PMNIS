<script setup lang="ts">
import { Stethoscope, GraduationCap, Check } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAccountStore } from '../stores/accountStore'

defineProps<{
  compact?: boolean
}>()

const accountStore = useAccountStore()
const { accounts, activeAccount, showAccountSwitcher } = storeToRefs(accountStore)

const dropdownRef = ref<HTMLElement | null>(null)

const onClickOutside = (e: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    accountStore.closeAccountSwitcher()
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <!-- Avatar button -->
    <button
      type="button"
      class="flex items-center justify-center rounded-full font-semibold text-white transition hover:ring-2 hover:ring-zinc-300"
      :class="compact ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'"
      :style="{ backgroundColor: activeAccount.avatarColor }"
      :title="`${activeAccount.name} (${activeAccount.role})`"
      @click="accountStore.toggleAccountSwitcher()"
    >
      {{ activeAccount.initials }}
    </button>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="showAccountSwitcher"
        class="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-panel"
      >
        <p class="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Switch account
        </p>
        <button
          v-for="account in accounts"
          :key="account.id"
          type="button"
          class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-50"
          @click="accountStore.switchAccount(account.id)"
        >
          <!-- Avatar circle -->
          <span
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
            :style="{ backgroundColor: account.avatarColor }"
          >
            {{ account.initials }}
          </span>

          <!-- Name & role -->
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-zinc-800">{{ account.name }}</p>
            <p class="flex items-center gap-1 text-[11px] text-zinc-500">
              <Stethoscope v-if="account.role === 'doctor'" class="h-3 w-3" />
              <GraduationCap v-else class="h-3 w-3" />
              {{ account.role === 'doctor' ? 'Doctor' : 'Student' }}
            </p>
          </div>

          <!-- Checkmark for active -->
          <Check
            v-if="account.id === activeAccount.id"
            class="h-4 w-4 flex-shrink-0 text-emerald-500"
          />
        </button>
      </div>
    </Transition>
  </div>
</template>
