<script setup lang="ts">
/** @fileoverview Action buttons for individual task items. */
import { computed, inject, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TASK_STATUS } from '@shared/constants'
import { NIcon } from 'naive-ui'
import MTooltip from '@/components/common/MTooltip.vue'
import {
  PauseOutline,
  PlayOutline,
  StopOutline,
  RefreshOutline,
  CloseOutline,
  TrashOutline,
  LinkOutline,
  InformationCircleOutline,
  FolderOpenOutline,
  OpenOutline,
  SyncOutline,
} from '@vicons/ionicons5'
import { type Component } from 'vue'
import type { Aria2Task } from '@shared/types'

const props = withDefaults(
  defineProps<{ task: Aria2Task; status: string; fileMissing?: boolean; density?: 'full' | 'compact' }>(),
  { density: 'full' },
)
const stoppingGids = inject<Ref<string[]>>('stoppingGids')
const isStopping = computed(() => stoppingGids?.value.includes(props.task.gid) ?? false)
const emit = defineEmits<{
  pause: []
  resume: []
  delete: []
  'delete-record': []
  'copy-link': []
  'show-info': []
  folder: []
  'open-file': []
  'stop-sharing': []
}>()

const { t } = useI18n()

interface ActionDef {
  key: string
  icon: Component
  label: string
  event: string
  tooltip?: string
  cls?: string
}

const actionsMap = computed<Record<string, ActionDef[]>>(() => ({
  [TASK_STATUS.ACTIVE]: [
    { key: 'toggle', icon: PauseOutline, label: t('task.pause-task'), event: 'pause' },
    { key: 'delete', icon: CloseOutline, label: t('task.delete-task'), event: 'delete' },
  ],
  [TASK_STATUS.PAUSED]: [
    { key: 'toggle', icon: PlayOutline, label: t('task.resume-task'), event: 'resume' },
    { key: 'delete', icon: CloseOutline, label: t('task.delete-task'), event: 'delete' },
  ],
  [TASK_STATUS.WAITING]: [
    { key: 'toggle', icon: PauseOutline, label: t('task.pause-task'), event: 'pause' },
    { key: 'delete', icon: CloseOutline, label: t('task.delete-task'), event: 'delete' },
  ],
  [TASK_STATUS.ERROR]: [
    { key: 'open', icon: OpenOutline, label: t('task.open-file'), event: 'open-file' },
    { key: 'folder', icon: FolderOpenOutline, label: t('task.show-in-folder'), event: 'folder' },
    { key: 'restart', icon: RefreshOutline, label: t('task.resume-task'), event: 'resume' },
    { key: 'trash', icon: TrashOutline, label: t('task.remove-record'), event: 'delete-record' },
  ],
  [TASK_STATUS.COMPLETE]: [
    { key: 'open', icon: OpenOutline, label: t('task.open-file'), event: 'open-file' },
    { key: 'folder', icon: FolderOpenOutline, label: t('task.show-in-folder'), event: 'folder' },
    { key: 'restart', icon: RefreshOutline, label: t('task.restart-task'), event: 'resume' },
    { key: 'trash', icon: TrashOutline, label: t('task.remove-record'), event: 'delete-record' },
  ],
  [TASK_STATUS.REMOVED]: [
    { key: 'open', icon: OpenOutline, label: t('task.open-file'), event: 'open-file' },
    { key: 'folder', icon: FolderOpenOutline, label: t('task.show-in-folder'), event: 'folder' },
    { key: 'restart', icon: RefreshOutline, label: t('task.restart-task'), event: 'resume' },
    { key: 'trash', icon: TrashOutline, label: t('task.remove-record'), event: 'delete-record' },
  ],
  [TASK_STATUS.SHARING]: [
    {
      key: 'stop',
      icon: StopOutline,
      label: t('task.stop-sharing') || 'Stop Sharing',
      event: 'stop-sharing',
      tooltip: t('task.stop-sharing-tip') || 'Download complete. Click to stop sharing.',
      cls: 'stop-sharing',
    },
    { key: 'delete', icon: CloseOutline, label: t('task.delete-task'), event: 'delete' },
  ],
}))

const actions = computed(() => {
  const primary = actionsMap.value[props.status] || []
  const primaryKeys = new Set(primary.map((a) => a.key))

  // Destructive actions (trash, delete) always go to the far right
  const destructiveKeys = new Set(['trash', 'delete'])
  const leading = primary.filter((a) => !destructiveKeys.has(a.key))
  const trailing = primary.filter((a) => destructiveKeys.has(a.key))

  const common: ActionDef[] = [
    { key: 'folder', icon: FolderOpenOutline, label: t('task.show-in-folder'), event: 'folder' },
    { key: 'link', icon: LinkOutline, label: t('task.copy-link'), event: 'copy-link' },
    { key: 'info', icon: InformationCircleOutline, label: t('task.task-detail-title'), event: 'show-info' },
  ].filter((a) => !primaryKeys.has(a.key))

  return [...leading, ...common, ...trailing].reverse()
})

function onAction(event: string) {
  switch (event) {
    case 'pause':
      emit('pause')
      break
    case 'resume':
      emit('resume')
      break
    case 'delete':
      emit('delete')
      break
    case 'delete-record':
      emit('delete-record')
      break
    case 'copy-link':
      emit('copy-link')
      break
    case 'show-info':
      emit('show-info')
      break
    case 'folder':
      emit('folder')
      break
    case 'open-file':
      emit('open-file')
      break
    case 'stop-sharing':
      emit('stop-sharing')
      break
  }
}
</script>

<template>
  <TransitionGroup
    tag="ul"
    name="action-item"
    class="task-item-actions"
    :class="{ 'task-item-actions--compact': props.density === 'compact' }"
  >
    <li v-for="action in actions" :key="action.key" class="task-item-action-slot">
      <MTooltip :style="action.tooltip ? 'max-width: 220px' : ''">
        <template #trigger>
          <button
            type="button"
            class="task-item-action"
            :class="[
              action.cls,
              {
                'is-stopping': action.event === 'stop-sharing' && isStopping,
              },
            ]"
            :disabled="action.event === 'stop-sharing' && isStopping"
            :aria-label="action.label"
            @click="onAction(action.event)"
          >
            <span class="task-action-visual" aria-hidden="true">
              <span v-if="action.event === 'stop-sharing'" class="stop-icon-wrapper">
                <span class="stop-icon-static" :class="{ 'fade-out': isStopping }">
                  <NIcon class="task-action-icon"><StopOutline /></NIcon>
                </span>
                <span class="stop-icon-spin" :class="{ 'fade-in': isStopping }">
                  <NIcon class="task-action-icon"><SyncOutline /></NIcon>
                </span>
              </span>
              <Transition v-else name="icon-swap" mode="out-in">
                <NIcon :key="action.event" class="task-action-icon"><component :is="action.icon" /></NIcon>
              </Transition>
            </span>
          </button>
        </template>
        <template v-if="action.event === 'stop-sharing' && isStopping">
          {{ t('task.stopping-sharing') || 'Stopping…' }}
        </template>
        <template v-else>
          {{ action.tooltip || action.label }}
        </template>
      </MTooltip>
    </li>
  </TransitionGroup>
</template>

<style scoped>
.task-item-actions {
  --task-action-height: 32px;
  --task-action-padding-x: 12px;
  --task-action-item-margin: 3px;
  --task-action-icon-size: 20px;
  --task-action-item-max-width: 38px;
  --task-action-button-size: 32px;
  display: flex;
  align-items: center;
  height: var(--task-action-height);
  padding: 0 var(--task-action-padding-x);
  margin: 0;
  overflow: hidden;
  user-select: none;
  cursor: default;
  direction: rtl;
  border: 1px solid var(--m3-surface-container-highest);
  color: var(--m3-outline);
  background-color: var(--task-action-bg);
  border-radius: 18px;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  list-style: none;
}
.task-item-actions:hover {
  border-color: var(--m3-outline);
  background-color: var(--m3-surface-container-high);
}
.task-item-action-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--task-action-button-size);
  width: var(--task-action-button-size);
  height: var(--task-action-button-size);
  margin: 0 var(--task-action-item-margin);
  max-width: var(--task-action-item-max-width);
  direction: ltr;
  transition:
    max-width 0.2s ease-out,
    margin 0.2s ease-out,
    opacity 0.2s ease-out;
}
.task-item-action {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--task-action-button-size);
  height: var(--task-action-button-size);
  min-width: var(--task-action-button-size);
  margin: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 0;
  line-height: var(--task-action-icon-size);
  cursor: pointer;
  transition: color 0.15s;
}
.task-item-actions--compact {
  --task-action-height: 24px;
  --task-action-padding-x: 10px;
  --task-action-item-margin: 3px;
  --task-action-icon-size: 16px;
  --task-action-item-max-width: 28px;
  --task-action-button-size: 22px;
  border-radius: 13px;
}
.task-item-action:hover,
.task-item-action:active,
.task-item-action:focus-visible {
  color: var(--m3-primary);
}
.task-item-action.stop-sharing {
  color: var(--m3-success);
}
.task-item-action.stop-sharing:hover,
.task-item-action.stop-sharing:active,
.task-item-action.stop-sharing:focus-visible {
  color: var(--m3-success);
}
.task-item-action.is-stopping,
.task-item-action.is-stopping:hover {
  color: var(--m3-warning);
  cursor: default;
}
.task-action-visual {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--task-action-icon-size);
  height: var(--task-action-icon-size);
  transform: scale(1);
  transform-origin: center;
  transition: transform 0.18s cubic-bezier(0.05, 0.7, 0.1, 1);
}
.task-item-action:active .task-action-visual {
  transform: scale(0.9);
  transition: transform 0.09s cubic-bezier(0.2, 0, 0, 1);
}

/* Icon crossfade wrapper */
.stop-icon-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--task-action-icon-size);
  height: var(--task-action-icon-size);
}
.task-action-icon {
  font-size: var(--task-action-icon-size);
}
.stop-icon-static,
.stop-icon-spin {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.5s ease;
}
.stop-icon-static {
  opacity: 1;
}
.stop-icon-static.fade-out {
  opacity: 0;
}
.stop-icon-spin {
  opacity: 0;
}
.stop-icon-spin.fade-in {
  opacity: 1;
  animation: spin-stop 0.9s linear infinite;
  will-change: transform;
  contain: layout style paint;
}
@keyframes spin-stop {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* M3 icon crossfade for play ↔ pause toggle */
.icon-swap-enter-active {
  transition:
    opacity 0.2s cubic-bezier(0.05, 0.7, 0.1, 1),
    transform 0.2s cubic-bezier(0.05, 0.7, 0.1, 1);
}
.icon-swap-leave-active {
  transition:
    opacity 0.15s cubic-bezier(0.3, 0, 0.8, 0.15),
    transform 0.15s cubic-bezier(0.3, 0, 0.8, 0.15);
}
.icon-swap-enter-from {
  opacity: 0;
  transform: scale(0.6);
}
.icon-swap-leave-to {
  opacity: 0;
  transform: scale(0.6);
}
/* ── TransitionGroup: directional toolbar grow/shrink ────────── */

/* Enter: button slides in horizontally (width 0 → full) */
.action-item-enter-active {
  transition:
    opacity 0.2s ease-out,
    max-width 0.2s ease-out,
    margin 0.2s ease-out;
}

/* Leave: button collapses out horizontally (width full → 0) */
.action-item-leave-active {
  transition:
    opacity 0.15s ease-in,
    max-width 0.15s ease-in,
    margin 0.15s ease-in;
  position: absolute;
}

.action-item-enter-from {
  opacity: 0;
  max-width: 0 !important;
  margin: 0 !important;
  overflow: hidden;
}

.action-item-leave-to {
  opacity: 0;
  max-width: 0 !important;
  margin: 0 !important;
  overflow: hidden;
}

/* Move transition: remaining items slide smoothly to fill gaps */
.action-item-move {
  transition: transform 0.2s ease-out;
}
</style>
