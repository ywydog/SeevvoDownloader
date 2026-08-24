/**
 * @fileoverview Extracted task CRUD operations from the Pinia task store.
 *
 * Contains: removeTask, pauseTask, resumeTask, pauseAllTask, resumeAllTask,
 * toggleTask, stopSharing, stopAllSharing, removeTaskRecord, purgeTaskRecord,
 * batchRemoveTask.
 *
 * Uses dependency injection — accepts API + store refs instead of importing
 * them directly, enabling testability and keeping the task store thin.
 */
import { TASK_STATUS } from '@shared/constants'
import { checkTaskIsBT, checkTaskIsSharing, getTaskSharingKind } from '@shared/utils'
import { logger } from '@shared/logger'
import { buildSharingCompletionRecord } from '@/composables/useTaskLifecycle'
import { cleanupAria2ControlFiles } from '@/composables/useFileDelete'
import { useHistoryStore } from '@/stores/history'
import type { Aria2Task, TaskApi } from '@shared/types'
import type { Ref } from 'vue'

interface TaskOperationsDeps {
  api: TaskApi
  taskList: Ref<Aria2Task[]>
  currentTaskGid: Ref<string>
  hideTaskDetail: () => void
  fetchList: () => Promise<void>
}

export function createTaskOperations(deps: TaskOperationsDeps) {
  const { api, taskList, currentTaskGid, hideTaskDetail, fetchList } = deps

  async function resumeTasks(tasks: Aria2Task[]): Promise<{ resumed: number; blocked: number }> {
    const resumableGids = tasks.map((task) => task.gid)
    if (resumableGids.length > 0) {
      await api.batchResumeTask({ gids: resumableGids })
    }
    return { resumed: resumableGids.length, blocked: 0 }
  }

  async function removeHistoryRecordForDeletedTask(task: Aria2Task): Promise<void> {
    const historyStore = useHistoryStore()
    if (task.infoHash) {
      try {
        await historyStore.removeByInfoHash(task.infoHash)
      } catch (e) {
        logger.debug('TaskOps.removeTask', `removeByInfoHash infoHash=${task.infoHash} skipped: ${e}`)
      }
    }
    try {
      await historyStore.removeRecord(task.gid)
    } catch (e) {
      logger.debug('TaskOps.removeTask', `removeHistory gid=${task.gid} skipped: ${e}`)
    }
  }

  async function removeHistoryRecordsByGid(gids: string[], scope: string): Promise<void> {
    if (gids.length === 0) return
    const historyStore = useHistoryStore()
    for (const gid of gids) {
      try {
        await historyStore.removeRecord(gid)
      } catch (e) {
        logger.debug(scope, `removeHistory gid=${gid} skipped: ${e}`)
      }
    }
  }

  async function removeTask(task: Aria2Task) {
    if (task.gid === currentTaskGid.value) hideTaskDetail()
    try {
      await api.removeTask({ gid: task.gid })
      // Purge from aria2's stopped-result list so it is not saved again.
      try {
        await api.removeTaskRecord({ gid: task.gid })
      } catch (e) {
        logger.debug('TaskOps.removeTask', `removeTaskRecord gid=${task.gid} skipped: ${e}`)
      }
      logger.info('TaskOps.removeTask', `gid=${task.gid}`)
    } finally {
      await removeHistoryRecordForDeletedTask(task)
      await fetchList()
      await api.saveSession()
    }
  }

  async function pauseTask(task: Aria2Task) {
    const isBT = checkTaskIsBT(task)
    const promise = isBT ? api.forcePauseTask({ gid: task.gid }) : api.pauseTask({ gid: task.gid })
    try {
      await promise
      logger.info('TaskOps.pauseTask', `gid=${task.gid} bt=${isBT}`)
    } finally {
      await fetchList()
      await api.saveSession()
    }
  }

  async function resumeTask(task: Aria2Task): Promise<boolean> {
    try {
      await api.resumeTask({ gid: task.gid })
      logger.info('TaskOps.resumeTask', `gid=${task.gid}`)
      return true
    } finally {
      await fetchList()
      await api.saveSession()
    }
  }

  async function pauseAllTask() {
    try {
      const pausableTasks = taskList.value.filter(
        (t) => (t.status === TASK_STATUS.ACTIVE || t.status === TASK_STATUS.WAITING) && !checkTaskIsSharing(t),
      )
      if (pausableTasks.length > 0) {
        await Promise.allSettled(pausableTasks.map((t) => api.forcePauseTask({ gid: t.gid })))
      }
      logger.info(
        'TaskOps.pauseAllTask',
        `paused=${pausableTasks.length} gids=[${pausableTasks.map((t) => t.gid).join(',')}]`,
      )
    } finally {
      await fetchList()
      await api.saveSession()
    }
  }

  async function resumeAllTask(): Promise<{ resumed: number; blocked: number }> {
    try {
      const pausedTasks = taskList.value.filter((task) => task.status === TASK_STATUS.PAUSED)
      const result = await resumeTasks(pausedTasks)
      logger.info('TaskOps.resumeAllTask', `resumed=${result.resumed} blocked=${result.blocked}`)
      return result
    } finally {
      await fetchList()
      await api.saveSession()
    }
  }

  function toggleTask(task: Aria2Task) {
    const { status } = task
    if (status === TASK_STATUS.ACTIVE && !checkTaskIsSharing(task)) return pauseTask(task)
    if (status === TASK_STATUS.WAITING) return pauseTask(task)
    if (status === TASK_STATUS.PAUSED) return resumeTask(task)
    logger.debug('TaskOps.toggleTask', `no-op gid=${task.gid} status=${status} sharing=${checkTaskIsSharing(task)}`)
  }

  async function stopSharing(task: Aria2Task) {
    const { gid } = task
    const protocolKind = getTaskSharingKind(task) ?? (task.bittorrent ? 'bt' : task.ed2k ? 'ed2k' : null)
    try {
      await api.forcePauseTask({ gid })
      await api.removeTask({ gid })
      // Purge from aria2's stopped list so it is not restored on restart.
      try {
        await api.removeTaskRecord({ gid })
      } catch (e) {
        logger.debug('TaskOps.stopSharing', `removeTaskRecord gid=${gid} skipped: ${e}`)
      }
      if (protocolKind === 'bt' && task.following) {
        try {
          await api.removeTaskRecord({ gid: task.following })
        } catch (e) {
          logger.debug('TaskOps.stopSharing', `removeTaskRecord following=${task.following} skipped: ${e}`)
        }
      }
      const record = buildSharingCompletionRecord(task)
      const historyStore = useHistoryStore()
      if (protocolKind === 'bt' && task.infoHash) {
        await historyStore.removeByInfoHash(task.infoHash, task.gid)
      }
      await historyStore.addRecord(record)
      if (protocolKind === 'bt' || protocolKind === 'ed2k') {
        try {
          await cleanupAria2ControlFiles(task)
        } catch (e) {
          logger.debug('TaskOps.stopSharing', `cleanupControlFiles gid=${gid} skipped: ${e}`)
        }
      }
      logger.info('TaskOps.stopSharing', `gid=${gid} kind=${protocolKind ?? 'unknown'}`)
    } finally {
      await fetchList()
      await api.saveSession()
    }
  }

  async function stopAllSharing(): Promise<number> {
    const sharingTasks = taskList.value.filter(checkTaskIsSharing)
    if (sharingTasks.length === 0) return 0
    await Promise.allSettled(sharingTasks.map((t) => stopSharing(t)))
    logger.info('TaskOps.stopAllSharing', `stopped ${sharingTasks.length} sharing task(s)`)
    return sharingTasks.length
  }

  async function removeTaskRecord(task: Aria2Task) {
    const { gid, status } = task
    if (gid === currentTaskGid.value) hideTaskDetail()
    const { ERROR, COMPLETE, REMOVED } = TASK_STATUS
    if ([ERROR, COMPLETE, REMOVED].indexOf(status) === -1) return
    const historyStore = useHistoryStore()
    await historyStore.removeRecord(gid)
    try {
      await api.removeTaskRecord({ gid })
    } catch (e) {
      logger.debug('TaskStore.removeTaskRecord.aria2', e)
    }
    await fetchList()
    await api.saveSession()
  }

  async function purgeTaskRecord() {
    const historyStore = useHistoryStore()
    await historyStore.clearRecords()
    try {
      await api.purgeTaskRecord()
    } catch (e) {
      logger.debug('TaskStore.purgeTaskRecord.aria2', e)
    }
    await fetchList()
    await api.saveSession()
  }

  async function batchRemoveTask(gids: string[]) {
    try {
      await api.batchRemoveTask({ gids })
      // Purge each gid from aria2's stopped-result list so it is not saved again.
      for (const gid of gids) {
        try {
          await api.removeTaskRecord({ gid })
        } catch (e) {
          logger.debug('TaskOps.batchRemoveTask', `removeTaskRecord gid=${gid} skipped: ${e}`)
        }
      }
      logger.info('TaskOps.batchRemoveTask', `removed ${gids.length} task(s) gids=[${gids.join(',')}]`)
    } finally {
      await removeHistoryRecordsByGid(gids, 'TaskOps.batchRemoveTask')
      await fetchList()
      await api.saveSession()
    }
  }

  async function hasActiveTasks(): Promise<boolean> {
    try {
      const tasks = await api.fetchTaskList({ type: TASK_STATUS.ACTIVE })
      return tasks.some(
        (t) => (t.status === TASK_STATUS.ACTIVE && !checkTaskIsSharing(t)) || t.status === TASK_STATUS.WAITING,
      )
    } catch (e) {
      logger.debug('TaskOps.hasActiveTasks', `fetchTaskList failed: ${e}`)
      return false
    }
  }

  async function hasPausedTasks(): Promise<boolean> {
    try {
      const tasks = await api.fetchTaskList({ type: TASK_STATUS.ACTIVE })
      return tasks.some((t) => t.status === TASK_STATUS.PAUSED)
    } catch (e) {
      logger.debug('TaskOps.hasPausedTasks', `fetchTaskList failed: ${e}`)
      return false
    }
  }

  async function saveSession() {
    await api.saveSession()
  }

  return {
    removeTask,
    pauseTask,
    resumeTask,
    resumeTasks,
    pauseAllTask,
    resumeAllTask,
    toggleTask,
    stopSharing,
    stopAllSharing,
    removeTaskRecord,
    purgeTaskRecord,
    batchRemoveTask,
    hasActiveTasks,
    hasPausedTasks,
    saveSession,
  }
}
