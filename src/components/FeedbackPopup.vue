<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { X, Star, MessageCircleQuestion } from 'lucide-vue-next'
import { useViewerStore } from '../stores/viewerStore'
import type { RejectReason, EditAcceptAnswer } from '../types/viewer'

const store = useViewerStore()
const { feedbackPopup } = storeToRefs(store)

// ── Star rating state ──
const hoverRating = ref(0)
const selectedRating = ref(0)

// ── Reject reason state ──
const rejectReason = ref<RejectReason | null>(null)
const rejectComment = ref('')

// ── Edit accept state ──
const editAcceptAnswer = ref<EditAcceptAnswer | null>(null)

// Reset local state when popup type changes or becomes visible
watch(
  () => feedbackPopup.value.visible,
  (visible) => {
    if (visible) {
      hoverRating.value = 0
      selectedRating.value = 0
      rejectReason.value = null
      rejectComment.value = ''
      editAcceptAnswer.value = null
    }
  },
)

const isFullAutoRating = computed(() => feedbackPopup.value.type === 'full-auto-rating')
const isRejectReason = computed(() => feedbackPopup.value.type === 'semi-reject-reason')
const isEditAccept = computed(() => feedbackPopup.value.type === 'semi-edit-accept')

const displayRating = computed(() => hoverRating.value || selectedRating.value)

const rejectOptions: { value: RejectReason; label: string }[] = [
  { value: 'false-positive', label: 'False positive - nothing is there' },
  { value: 'wrong-boundary', label: 'Wrong boundary / shape' },
  { value: 'wrong-label', label: 'Wrong label / classification' },
  { value: 'other', label: 'Other reason' },
]

const editAcceptOptions: { value: EditAcceptAnswer; label: string }[] = [
  { value: 'ai-too-big', label: 'AI detected too big area - I removed parts' },
  { value: 'ai-missed-area', label: 'AI missed some area - I added to it' },
  { value: 'both', label: 'Both - removed and added areas' },
  { value: 'minor-adjustment', label: 'Minor boundary adjustment' },
]

const canSubmitRating = computed(() => selectedRating.value > 0)
const canSubmitReject = computed(() => rejectReason.value !== null)
const canSubmitEdit = computed(() => editAcceptAnswer.value !== null)

const handleSubmit = () => {
  if (isFullAutoRating.value && canSubmitRating.value) {
    store.submitFullAutoRating(selectedRating.value)
  } else if (isRejectReason.value && canSubmitReject.value) {
    store.submitRejectReason(rejectReason.value!, rejectComment.value || undefined)
  } else if (isEditAccept.value && canSubmitEdit.value) {
    store.submitEditAcceptAnswer(editAcceptAnswer.value!)
  }
}

/**
 * Star click handler supporting half-star precision.
 * Clicking the left half of a star gives n-0.5, right half gives n.
 */
const handleStarClick = (starIndex: number, event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const isLeftHalf = event.clientX - rect.left < rect.width / 2
  selectedRating.value = isLeftHalf ? starIndex - 0.5 : starIndex
}

const handleStarHover = (starIndex: number, event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const isLeftHalf = event.clientX - rect.left < rect.width / 2
  hoverRating.value = isLeftHalf ? starIndex - 0.5 : starIndex
}

const handleStarLeave = () => {
  hoverRating.value = 0
}

/**
 * Returns fill state for a star: 'full', 'half', or 'empty'.
 */
const starFill = (starIndex: number): 'full' | 'half' | 'empty' => {
  const rating = displayRating.value
  if (rating >= starIndex) return 'full'
  if (rating >= starIndex - 0.5) return 'half'
  return 'empty'
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="translate-x-full opacity-0"
    enter-to-class="translate-x-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="translate-x-0 opacity-100"
    leave-to-class="translate-x-full opacity-0"
  >
    <div
      v-if="feedbackPopup.visible"
      class="fixed bottom-6 right-6 z-[300] w-80 rounded-2xl border border-zinc-200 bg-white shadow-2xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between rounded-t-2xl bg-zinc-50 px-4 py-3">
        <div class="flex items-center gap-2">
          <MessageCircleQuestion class="h-4 w-4 text-zinc-500" />
          <span class="text-xs font-semibold text-zinc-700">
            <template v-if="isFullAutoRating">How did the AI perform?</template>
            <template v-else-if="isRejectReason">Why did you reject this?</template>
            <template v-else>What did you change?</template>
          </span>
        </div>
        <button
          type="button"
          class="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-600"
          @click="store.dismissFeedback()"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="px-4 py-3">
        <!-- ═══ Full auto: star rating ═══ -->
        <template v-if="isFullAutoRating">
          <p class="mb-3 text-xs text-zinc-500">
            Rate how well the AI detected the tumors. Take your time to examine the results first.
          </p>

          <!-- Star row -->
          <div class="mb-2 flex items-center justify-center gap-1" @mouseleave="handleStarLeave">
            <button
              v-for="star in 5"
              :key="star"
              type="button"
              class="relative h-8 w-8 cursor-pointer"
              @click="handleStarClick(star, $event)"
              @mousemove="handleStarHover(star, $event)"
            >
              <!-- Empty star (background) -->
              <Star class="absolute inset-0 h-8 w-8 text-zinc-200" :stroke-width="1.5" />

              <!-- Full star -->
              <Star
                v-if="starFill(star) === 'full'"
                class="absolute inset-0 h-8 w-8 text-amber-400"
                fill="currentColor"
                :stroke-width="1.5"
              />

              <!-- Half star via clip -->
              <div
                v-else-if="starFill(star) === 'half'"
                class="absolute inset-0 overflow-hidden"
                style="width: 50%"
              >
                <Star
                  class="h-8 w-8 text-amber-400"
                  fill="currentColor"
                  :stroke-width="1.5"
                />
              </div>
            </button>
          </div>

          <!-- Rating label -->
          <p class="mb-3 text-center text-xs font-medium tabular-nums" :class="displayRating > 0 ? 'text-amber-600' : 'text-zinc-300'">
            {{ displayRating > 0 ? `${displayRating} / 5` : 'Select a rating' }}
          </p>
        </template>

        <!-- ═══ Semi-auto reject reason ═══ -->
        <template v-else-if="isRejectReason">
          <p class="mb-1 text-[11px] font-medium text-zinc-500">
            Detection: <span class="text-zinc-700">{{ feedbackPopup.detectionName }}</span>
          </p>
          <p class="mb-3 text-xs text-zinc-500">What was the problem with this detection?</p>

          <div class="space-y-1.5">
            <label
              v-for="opt in rejectOptions"
              :key="opt.value"
              class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition"
              :class="rejectReason === opt.value
                ? 'border-zinc-900 bg-zinc-50 text-zinc-900'
                : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
            >
              <input
                v-model="rejectReason"
                type="radio"
                name="reject-reason"
                :value="opt.value"
                class="sr-only"
              />
              <span
                class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
                :class="rejectReason === opt.value ? 'border-zinc-900 bg-zinc-900' : 'border-zinc-300'"
              >
                <span v-if="rejectReason === opt.value" class="h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              {{ opt.label }}
            </label>
          </div>

          <!-- Optional comment -->
          <textarea
            v-if="rejectReason === 'other'"
            v-model="rejectComment"
            placeholder="Please describe the issue..."
            class="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400"
            rows="2"
          />
        </template>

        <!-- ═══ Semi-auto edit + accept ═══ -->
        <template v-else-if="isEditAccept">
          <p class="mb-1 text-[11px] font-medium text-zinc-500">
            Detection: <span class="text-zinc-700">{{ feedbackPopup.detectionName }}</span>
          </p>
          <p class="mb-3 text-xs text-zinc-500">How did you modify the detected area?</p>

          <div class="space-y-1.5">
            <label
              v-for="opt in editAcceptOptions"
              :key="opt.value"
              class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition"
              :class="editAcceptAnswer === opt.value
                ? 'border-zinc-900 bg-zinc-50 text-zinc-900'
                : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
            >
              <input
                v-model="editAcceptAnswer"
                type="radio"
                name="edit-accept"
                :value="opt.value"
                class="sr-only"
              />
              <span
                class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
                :class="editAcceptAnswer === opt.value ? 'border-zinc-900 bg-zinc-900' : 'border-zinc-300'"
              >
                <span v-if="editAcceptAnswer === opt.value" class="h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              {{ opt.label }}
            </label>
          </div>
        </template>

        <!-- Submit / Skip -->
        <div class="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-600"
            @click="store.dismissFeedback()"
          >
            Skip
          </button>
          <button
            type="button"
            class="rounded-lg bg-zinc-900 px-4 py-1.5 text-[11px] font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="(isFullAutoRating && !canSubmitRating) || (isRejectReason && !canSubmitReject) || (isEditAccept && !canSubmitEdit)"
            @click="handleSubmit"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
