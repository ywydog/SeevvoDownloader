<script setup lang="ts">
/** @fileoverview 软件中心：希沃全家桶软件清单，支持多选/全选、下载源切换、批量下载、批量安装。 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NSelect, NButton, NCheckbox, NTag, NEmpty, useMessage, useDialog } from 'naive-ui'
import { useSoftwareCatalog, type SoftwareEntry } from '@/composables/useSoftwareCatalog'
import { DOWNLOAD_SOURCES, useDownloadSource } from '@/composables/useDownloadSource'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import { silentInstall, decompressArchive } from '@/api/installer'
import { logger } from '@shared/logger'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const taskStore = useTaskStore()
const preferenceStore = usePreferenceStore()
const { currentSource, setSource, getCurrentSourceName, resolveDownloadUrl } = useDownloadSource()
const { all, categories, byCategory } = useSoftwareCatalog()

/** 勾选集合 */
const selected = ref<Set<string>>(new Set())
/** 是否全选 */
const selectAllChecked = computed(() => selected.value.size === all.value.length && all.value.length > 0)
/** 正在提交中的软件名集合 */
const submitting = ref<Set<string>>(new Set())
/** 正在安装中的软件名集合 */
const installing = ref<Set<string>>(new Set())

const sourceOptions = DOWNLOAD_SOURCES.map((s) => ({ label: s.name, value: s.key }))

/** 缓存目录：下载目录下的 cache 子目录（与原 SeevvoDownloader 缓存机制一致） */
function cacheDir(): string {
  const base = preferenceStore.config.dir || ''
  return base ? `${base.replace(/[\\/]+$/, '')}/cache` : ''
}

function toggleItem(name: string) {
  const next = new Set(selected.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selected.value = next
}

function toggleSelectAll() {
  if (selectAllChecked.value) selected.value = new Set()
  else selected.value = new Set(all.value.map((s) => s.name))
}

function isSelected(name: string) {
  return selected.value.has(name)
}

async function submitDownload(item: SoftwareEntry): Promise<void> {
  const url = resolveDownloadUrl(item)
  if (!url) {
    message.warning(`${item.name}：未提供下载地址`)
    return
  }
  submitting.value.add(item.name)
  try {
    await taskStore.addUri({
      uris: [url],
      outs: [item.filename],
      options: {
        dir: cacheDir(),
        split: String(preferenceStore.config.split ?? 64),
      },
    })
    message.success(`${item.name}：已添加下载任务`)
  } catch (e) {
    logger.error('SoftwareCenter.submit', e)
    message.error(`${item.name}：添加下载任务失败`)
  } finally {
    submitting.value.delete(item.name)
  }
}

async function downloadSelected() {
  if (selected.value.size === 0) {
    message.info(t('software-center-select-none'))
    return
  }
  for (const name of selected.value) {
    const item = all.value.find((s) => s.name === name)
    if (item) await submitDownload(item)
  }
  router.push('/task/all').catch(() => {})
}

/** 安装单个软件：压缩包先解压再尝试静默安装目录内 exe；exe 直接静默安装 */
async function installOne(item: SoftwareEntry): Promise<boolean> {
  const base = preferenceStore.config.dir || ''
  if (!base) {
    message.warning(`${item.name}：未配置下载目录`)
    return false
  }
  const cache = cacheDir()
  const archivePath = `${cache}/${item.filename}`
  installing.value.add(item.name)
  try {
    if (item.decompress) {
      const outDir = `${cache}/${item.name}`
      const decompress = await decompressArchive(archivePath, outDir)
      if (!decompress.success) {
        message.error(`${item.name}：解压失败 - ${decompress.message}`)
        return false
      }
      message.info(`${item.name}：解压完成，请手动运行解压目录中的安装程序`)
      return true
    }
    const result = await silentInstall(archivePath)
    if (result.success) {
      message.success(`${item.name}：${result.message}`)
      return true
    }
    message.warning(`${item.name}：${result.message}`)
    return false
  } catch (e) {
    logger.error('SoftwareCenter.install', e)
    message.error(`${item.name}：安装失败（可能需要管理员权限或安装包未下载完成）`)
    return false
  } finally {
    installing.value.delete(item.name)
  }
}

/** 批量安装选中的软件（逐个串行执行） */
async function installSelected() {
  if (selected.value.size === 0) {
    message.info(t('software-center-select-none'))
    return
  }
  dialog.warning({
    title: t('software-center-install-confirm-title'),
    content: t('software-center-install-confirm-content', { count: selected.value.size }),
    positiveText: t('software-center-install') || '开始安装',
    negativeText: t('software-center-cancel') || '取消',
    onPositiveClick: async () => {
      for (const name of selected.value) {
        const item = all.value.find((s) => s.name === name)
        if (item) await installOne(item)
      }
    },
  })
}
</script>

<template>
  <div class="software-center">
    <header class="sc-header">
      <div>
        <h1 class="sc-title">{{ t('software-center-title') }}</h1>
        <p class="sc-subtitle">
          {{ t('software-center-subtitle') }}
          <span class="sc-source">（{{ t('software-center-download-source') }}：{{ getCurrentSourceName() }}）</span>
        </p>
      </div>
      <div class="sc-actions">
        <NSelect
          :value="currentSource()"
          :options="sourceOptions"
          size="small"
          style="width: 160px"
          :placeholder="t('software-center-select-source')"
          @update:value="(v: string) => setSource(v)"
        />
        <NButton size="small" @click="toggleSelectAll">
          {{ selectAllChecked ? t('software-center-deselect-all') : t('software-center-select-all') }}
        </NButton>
        <NButton size="small" type="primary" :disabled="selected.size === 0" @click="downloadSelected">
          {{ t('software-center-download-selected') }}（{{ selected.size }}）
        </NButton>
        <NButton
          size="small"
          type="success"
          :disabled="selected.size === 0 || installing.size > 0"
          :loading="installing.size > 0"
          @click="installSelected"
        >
          {{ t('software-center-install-selected') }}
        </NButton>
      </div>
    </header>

    <div v-if="all.length === 0" class="sc-empty">
      <NEmpty :description="t('software-center-empty')" />
    </div>

    <section v-for="cat in categories" :key="cat" class="sc-category">
      <h2 class="sc-category-title">
        <NTag size="small" :bordered="false" type="info">{{ cat }}</NTag>
        <span class="sc-category-count">{{ byCategory(cat).length }}</span>
      </h2>
      <div class="sc-grid">
        <label
          v-for="item in byCategory(cat)"
          :key="item.name"
          class="sc-card"
          :class="{ 'sc-card--selected': isSelected(item.name) }"
        >
          <NCheckbox :checked="isSelected(item.name)" @update:checked="toggleItem(item.name)">
            <span class="sc-card-name">{{ item.name }}</span>
            <span v-if="item.decompress" class="sc-card-tag">压缩包</span>
          </NCheckbox>
          <div class="sc-card-footer">
            <span class="sc-card-filename">{{ item.filename }}</span>
            <NButton
              size="tiny"
              text
              type="primary"
              :loading="submitting.has(item.name)"
              :disabled="submitting.has(item.name)"
              @click.prevent="submitDownload(item)"
            >
              {{ t('software-center-download') }}
            </NButton>
          </div>
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.software-center {
  padding: 20px 24px;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}
.sc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.sc-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--m3-on-surface);
}
.sc-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--m3-on-surface-variant);
}
.sc-source {
  opacity: 0.8;
}
.sc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sc-empty {
  padding: 60px 0;
}
.sc-category {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sc-category-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.sc-category-count {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
}
.sc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.sc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--task-item-bg, var(--m3-surface-container-lowest));
  border: 1px solid var(--m3-outline-variant);
  cursor: pointer;
  transition:
    border-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.sc-card:hover {
  border-color: var(--m3-primary);
}
.sc-card--selected {
  border-color: var(--m3-primary);
  background: color-mix(in srgb, var(--m3-primary) 8%, var(--task-item-bg, var(--m3-surface-container-lowest)));
}
.sc-card-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--m3-on-surface);
}
.sc-card-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--m3-info) 15%, transparent);
  color: var(--m3-info);
  margin-left: 6px;
}
.sc-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.sc-card-filename {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
