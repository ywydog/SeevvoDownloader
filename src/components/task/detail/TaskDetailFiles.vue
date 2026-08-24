<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NDataTable } from 'naive-ui'
import { bytesToSize } from '@shared/utils'
import { calcColumnWidth } from '@shared/utils/calcColumnWidth'
import type { Aria2File } from '@shared/types'
import { buildFileDetailRows, type FileDetailRow } from '@/composables/useTaskDetailRows'
import { renderDetailCopyableText } from './TaskDetailShared'

const props = defineProps<{
  files: Aria2File[]
  tooltip: string
  onCopy: (value: string, label: string) => void
}>()

const { t } = useI18n()
const rows = computed(() => buildFileDetailRows(props.files))

const columns = computed(() => {
  const data = rows.value
  return [
    {
      title: t('task.file-index') || '#',
      key: 'idx',
      width: calcColumnWidth({
        title: t('task.file-index') || '#',
        values: data.map((row) => String(row.idx)),
        sortable: true,
      }),
      sorter: (a: FileDetailRow, b: FileDetailRow) => a.idx - b.idx,
    },
    {
      title: t('task.file-name') || 'Name',
      key: 'name',
      render: (row: FileDetailRow) =>
        renderDetailCopyableText({
          value: row.name,
          label: t('task.file-name'),
          tooltip: props.tooltip,
          onCopy: props.onCopy,
        }),
    },
    {
      title: t('task.file-extension') || 'Ext',
      key: 'extension',
      width: calcColumnWidth({
        title: t('task.file-extension') || 'Ext',
        values: data.map((row) => row.extension),
      }),
    },
    {
      title: t('task.task-peer-percent'),
      key: 'percent',
      width: calcColumnWidth({
        title: t('task.task-peer-percent'),
        values: data.map((row) => String(row.percent)),
        sortable: true,
      }),
      align: 'right' as const,
      sorter: (a: FileDetailRow, b: FileDetailRow) => a.percent - b.percent,
    },
    {
      title: t('task.file-completed'),
      key: 'completedLength',
      width: calcColumnWidth({
        title: t('task.file-completed'),
        values: data.map((row) => bytesToSize(String(row.completedLength))),
        sortable: true,
      }),
      align: 'right' as const,
      sorter: (a: FileDetailRow, b: FileDetailRow) => a.completedLength - b.completedLength,
      render: (row: FileDetailRow) => bytesToSize(String(row.completedLength)),
    },
    {
      title: t('task.file-size') || 'Size',
      key: 'length',
      width: calcColumnWidth({
        title: t('task.file-size') || 'Size',
        values: data.map((row) => bytesToSize(String(row.length))),
        sortable: true,
      }),
      align: 'right' as const,
      sorter: (a: FileDetailRow, b: FileDetailRow) => a.length - b.length,
      render: (row: FileDetailRow) => bytesToSize(String(row.length)),
    },
  ]
})
</script>

<template>
  <NDataTable
    :columns="columns"
    :data="rows"
    :row-key="(row: FileDetailRow) => row.idx"
    size="small"
    :bordered="true"
    :max-height="400"
    :virtual-scroll="true"
    :min-row-height="34"
    striped
  />
</template>
