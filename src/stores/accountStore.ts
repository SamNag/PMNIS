import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserAccount } from '../types/viewer'

const defaultAccounts: UserAccount[] = [
  { id: 'doctor-1', name: 'Dr. Marta Novak', role: 'doctor', initials: 'MN', avatarColor: '#3b82f6' },
  { id: 'student-1', name: 'Adam Horvath', role: 'student', initials: 'AH', avatarColor: '#8b5cf6' },
]

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<UserAccount[]>(defaultAccounts)
  const activeAccountId = ref(defaultAccounts[0]!.id)
  const showAccountSwitcher = ref(false)

  const activeAccount = computed(() =>
    accounts.value.find((a) => a.id === activeAccountId.value)!,
  )
  const isDoctor = computed(() => activeAccount.value.role === 'doctor')
  const isStudent = computed(() => activeAccount.value.role === 'student')

  function switchAccount(id: string) {
    activeAccountId.value = id
    showAccountSwitcher.value = false
  }

  function toggleAccountSwitcher() {
    showAccountSwitcher.value = !showAccountSwitcher.value
  }

  function closeAccountSwitcher() {
    showAccountSwitcher.value = false
  }

  return {
    accounts,
    activeAccountId,
    showAccountSwitcher,
    activeAccount,
    isDoctor,
    isStudent,
    switchAccount,
    toggleAccountSwitcher,
    closeAccountSwitcher,
  }
})
