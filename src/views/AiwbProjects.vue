<script setup lang="ts">
/** @fileoverview Aiwb项目页：清单 + 按需拉取 GitHub Releases + 产物下载/安装。 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { NInput, NButton, NTag, NEmpty, NSpin, NSelect, NModal, useMessage } from 'naive-ui'
import { useAiwbCatalog, type AiwbEntry } from '@/composables/useAiwbCatalog'
import { useGitHubReleases, type GitHubRelease, type GitHubAsset } from '@/composables/useGitHubReleases'
import { DOWNLOAD_SOURCES, useDownloadSource } from '@/composables/useDownloadSource'
import {
  useAiwbDownload,
  buildAcceleratedUrl,
  isExecutableExt,
  isArchiveExt,
  assetExtension,
} from '@/composables/useAiwbDownload'
import { usePreferenceStore } from '@/stores/preference'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import aria2Api from '@/api/aria2'
import { resolveTaskFilePath } from '@/composables/useArchivedPaths'
import type { Aria2Task } from '@shared/types'

const { t } = useI18n()
const message = useMessage()
const { all, addRepo, removeRepo, isOwnerRepo } = useAiwbCatalog()
const { fetchReleases, probeSource } = useGitHubReleases()
const { currentSource, setSource, getCurrentSourceName } = useDownloadSource()
const aiwb = useAiwbDownload()
const preferenceStore = usePreferenceStore()

// —— 状态 ——
const query = ref('')
const activeEntry = ref<AiwbEntry | null>(null)
const releases = ref<GitHubRelease[]>([])
const loading = ref(false)
const releaseError = ref<string | null>(null)
const showArtifacts = ref(false)
const selectedRelease = ref<GitHubRelease | null>(null)
const addRepoInput = ref('')

// —— 产物弹窗 ——
const sourceSpeeds = ref<Record<string, number | null>>({})
const probing = ref(false)

/** 已发起下载的产物的自动处理动作：asset 文件名 → 'run' | 'install'。
 *  注意：store.addUri 不返回 gid，故用完成后解析出的本地文件名作关联键。
 */
const pendingActions = new Map<string, 'run' | 'install'>()

// —— 解压后选择静默安装程序 ——
const installCandidates = ref<{ name: string; path: string }[]>([])
const showInstallerPicker = ref(false)

let unlistenComplete: (() => void) | null = null

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return all.value
  return all.value.filter((e) => e.name.toLowerCase().includes(q) || e.repo.toLowerCase().includes(q))
})

const sourceOptions = computed(() =>
  DOWNLOAD_SOURCES.map((s) => {
    const ms = sourceSpeeds.value[s.key]
    let speedText: string
    if (probing.value) speedText = t('aiwb-probing')
    else if (ms == null) speedText = t('aiwb-source-unavailable')
    else speedText = `${ms}ms`
    return { label: `${s.name} · ${speedText}`, value: s.key }
  }),
)

function extOf(name: string) {
  return assetExtension(name)
}

function extTagType(ext: string) {
  return isExecutableExt(ext) ? 'success' : isArchiveExt(ext) ? 'warning' : 'info'
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function openEntry(entry: AiwbEntry) {
  activeEntry.value = entry
  selectedRelease.value = null
  releases.value = []
  releaseError.value = null
  loading.value = true
  const res = await fetchReleases(entry.repo, {
    proxy: preferenceStore.config.proxy?.server ?? null,
  })
  loading.value = false
  if (res.error) releaseError.value = res.error
  else {
    releases.value = res.data
    if (res.data.length > 0) selectedRelease.value = res.data[0]
  }
}

function selectRelease(rel: GitHubRelease) {
  selectedRelease.value = rel
}

function openArtifacts(rel: GitHubRelease) {
  selectedRelease.value = rel
  showArtifacts.value = true
  void refreshSpeeds()
}

async function refreshSpeeds() {
  probing.value = true
  try {
    for (const s of DOWNLOAD_SOURCES) {
      const url = `${s.prefix}/Ping`
      const ms = await probeSource(url, { proxy: preferenceStore.config.proxy?.server ?? null })
      sourceSpeeds.value[s.key] = ms
    }
  } finally {
    probing.value = false
  }
}

function artifactUrl(asset: GitHubAsset): string {
  const prefix = DOWNLOAD_SOURCES.find((s) => s.key === currentSource())?.prefix ?? ''
  return buildAcceleratedUrl(asset.browserDownloadUrl, prefix)
}

async function downloadAsset(asset: GitHubAsset) {
  const url = artifactUrl(asset)
  try {
    await aiwb.addDownload(url, asset.name, preferenceStore.config.split ?? 64)
    const ext = extOf(asset.name)
    if (isExecutableExt(ext)) pendingActions.set(asset.name, 'run')
    else if (isArchiveExt(ext)) pendingActions.set(asset.name, 'install')
    message.success(`${activeEntry.value?.name ?? ''}：${asset.name} ${t('aiwb-download-task-added')}`)
    showArtifacts.value = false
  } catch {
    message.error(`${activeEntry.value?.name ?? ''}：${asset.name} ${t('aiwb-download-task-failed')}`)
  }
}

async function handleAddRepo() {
  const repo = addRepoInput.value.trim()
  if (!isOwnerRepo(repo)) {
    message.warning(t('aiwb-invalid-repo'))
    return
  }
  const ok = addRepo(repo)
  if (!ok) {
    message.warning(t('aiwb-repo-exists'))
    return
  }
  addRepoInput.value = ''
  message.success(t('aiwb-repo-added'))
}

function releaseChannel(rel: GitHubRelease): { label: string; type: 'success' | 'warning' } {
  if (!rel.prerelease) return { label: t('aiwb-official'), type: 'success' }
  const s = `${rel.tagName} ${rel.name}`.toLowerCase()
  if (/(beta|rc|preview|alpha)/.test(s)) return { label: t('aiwb-beta'), type: 'warning' }
  return { label: t('aiwb-beta'), type: 'warning' }
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

/** 下载完成 → 运行 exe 或解压后安装 */
async function handleDownloadComplete(task: Aria2Task) {
  const filePath = resolveTaskFilePath(task)
  if (!filePath) return
  const name = basenameOf(filePath)
  const action = pendingActions.get(name)
  if (!action) return
  pendingActions.delete(name)

  try {
    if (action === 'run') {
      await aiwb.runExecutable(filePath)
      message.success(`${name}：${t('aiwb-run-started')}`)
      return
    }
    // install：先解压到安装目录，再列出可执行安装程序供用户选择
    message.info(`${name}：${t('aiwb-decompressing')}`)
    const decomp = await aiwb.installArchive(filePath)
    if (!decomp.success) {
      message.error(`${name}：${t('aiwb-decompress-failed')} - ${decomp.message}`)
      return
    }
    const installDir = aiwb.installDir()
    if (!installDir) {
      message.warning(t('aiwb-no-install-dir'))
      return
    }
    const files = await invoke<string[]>('list_dir_files', { path: installDir })
    const executables = files
      .filter((f) => isExecutableExt(extOf(f)))
      .map((f) => ({ name: f, path: `${installDir}/${f}` }))
    installCandidates.value = executables
    if (executables.length === 0) {
      message.success(`${name}：${t('aiwb-decompress-done-manual')}`)
    } else {
      showInstallerPicker.value = true
    }
  } catch {
    message.error(`${name}：${t('aiwb-auto-handle-failed')}`)
  }
}

async function runInstaller(candidate: { name: string; path: string }) {
  try {
    const result = await aiwb.silentExecutable(candidate.path)
    if (result.success) message.success(`${candidate.name}：${result.message}`)
    else message.warning(`${candidate.name}：${result.message}`)
  } catch {
    message.error(`${candidate.name}：${t('aiwb-run-failed')}`)
  }
  showInstallerPicker.value = false
}

onMounted(async () => {
  unlistenComplete = await listen<{ gid: string }>('task-monitor:complete', async ({ payload }) => {
    try {
      const task = await aria2Api.fetchTaskItem({ gid: payload.gid })
      await handleDownloadComplete(task)
    } catch {
      /* 忽略非本项目发起的任务 */
    }
  })
})

onBeforeUnmount(() => {
  unlistenComplete?.()
  unlistenComplete = null
  pendingActions.clear()
})
</script>

<template>
  <div class="aiwb">
    <header class="aiwb-header">
      <div>
        <h1 class="aiwb-title">{{ t('app.aiwb') }}</h1>
        <p class="aiwb-subtitle">{{ t('aiwb-subtitle') }}</p>
      </div>
      <div class="aiwb-actions">
        <NInput
          v-model:value="query"
          size="small"
          clearable
          :placeholder="t('aiwb-search-placeholder')"
          style="width: 220px"
        />
        <NInput
          v-model:value="addRepoInput"
          size="small"
          :placeholder="t('aiwb-add-repo-placeholder')"
          style="width: 220px"
          @keyup.enter="handleAddRepo"
        />
        <NButton size="small" type="primary" @click="handleAddRepo">
          {{ t('aiwb-add-repo') }}
        </NButton>
      </div>
    </header>

    <div v-if="filtered.length === 0" class="aiwb-empty">
      <NEmpty :description="t('aiwb-empty')" />
    </div>

    <section class="aiwb-grid">
      <div
        v-for="entry in filtered"
        :key="entry.repo"
        class="aiwb-card"
        :class="{ 'aiwb-card--active': activeEntry?.repo === entry.repo }"
        @click="openEntry(entry)"
      >
        <div class="aiwb-card-head">
          <span class="aiwb-card-name">{{ entry.name }}</span>
          <NTag v-if="entry.custom" size="small" :bordered="false" type="info">
            {{ t('aiwb-user-added') }}
          </NTag>
        </div>
        <div class="aiwb-card-repo">{{ entry.repo }}</div>
        <div class="aiwb-card-footer">
          <span class="aiwb-card-desc">{{ entry.desc }}</span>
          <NButton v-if="entry.custom" size="tiny" text type="error" @click.stop="removeRepo(entry.repo)">
            {{ t('aiwb-remove') }}
          </NButton>
        </div>
      </div>
    </section>

    <!-- 详情：版本左右布局 -->
    <NModal
      :show="!!activeEntry"
      preset="card"
      :title="activeEntry?.name ?? ''"
      style="width: 720px; max-width: 92vw"
      @update:show="
        (v: boolean) => {
          if (!v) activeEntry = null
        }
      "
    >
      <div class="aiwb-detail">
        <div class="aiwb-detail-repo">{{ activeEntry?.repo }}</div>
        <div v-if="loading" class="aiwb-detail-loading">
          <NSpin />
        </div>
        <div v-else-if="releaseError" class="aiwb-detail-error">
          <span>{{ t('aiwb-release-load-failed') }}</span>
          <NButton size="small" type="primary" @click="activeEntry && openEntry(activeEntry)">
            {{ t('retry') }}
          </NButton>
        </div>
        <div v-else-if="releases.length === 0" class="aiwb-detail-empty">
          <NEmpty :description="t('aiwb-no-releases')" />
        </div>
        <div v-else class="aiwb-releases">
          <div
            v-for="rel in releases"
            :key="rel.tagName"
            class="aiwb-release"
            :class="{ 'aiwb-release--selected': selectedRelease?.tagName === rel.tagName }"
            @click="selectRelease(rel)"
          >
            <div class="aiwb-release-left">
              <span class="aiwb-release-tag">{{ rel.tagName }}</span>
              <NTag size="small" :bordered="false" :type="releaseChannel(rel).type">
                {{ releaseChannel(rel).label }}
              </NTag>
            </div>
            <div class="aiwb-release-right">
              <div class="aiwb-release-title">{{ rel.name || rel.tagName }}</div>
              <pre class="aiwb-release-body">{{ rel.body || t('aiwb-no-release-notes') }}</pre>
            </div>
          </div>
        </div>

        <!-- 选择解压后的安装程序 -->
        <NModal
          :show="showInstallerPicker"
          preset="card"
          :title="t('aiwb-pick-installer')"
          style="width: 480px; max-width: 92vw"
          @update:show="
            (v: boolean) => {
              if (!v) showInstallerPicker = false
            }
          "
        >
          <div class="aiwb-installer-list">
            <NButton
              v-for="c in installCandidates"
              :key="c.path"
              size="small"
              type="primary"
              class="aiwb-installer-item"
              @click="runInstaller(c)"
            >
              {{ c.name }}
            </NButton>
          </div>
        </NModal>
      </div>
    </NModal>

    <!-- 悬浮下载按钮：选中某 release 时固定悬浮 -->
    <NButton
      v-if="selectedRelease"
      class="aiwb-float-download"
      type="primary"
      :title="`${t('aiwb-download')} ${selectedRelease.tagName}`"
      @click="openArtifacts(selectedRelease)"
    >
      {{ t('aiwb-download') }}
    </NButton>

    <!-- 产物弹窗 -->
    <NModal
      :show="showArtifacts"
      preset="card"
      :title="`${activeEntry?.name ?? ''} · ${selectedRelease?.tagName ?? ''}`"
      style="width: 620px; max-width: 92vw"
      @update:show="
        (v: boolean) => {
          if (!v) showArtifacts = false
        }
      "
    >
      <div v-if="selectedRelease" class="aiwb-artifacts">
        <div class="aiwb-artifacts-bar">
          <NSelect
            :value="currentSource()"
            :options="sourceOptions"
            size="small"
            style="flex: 1"
            :placeholder="t('aiwb-download-source')"
            @update:value="(v: string) => setSource(v)"
          />
          <NButton size="small" :loading="probing" @click="refreshSpeeds">
            {{ t('aiwb-reprobe') }}
          </NButton>
        </div>
        <div class="aiwb-artifacts-source-name">{{ t('aiwb-download-source') }}：{{ getCurrentSourceName() }}</div>
        <div class="aiwb-asset-list">
          <div v-for="asset in selectedRelease.assets" :key="asset.name" class="aiwb-asset">
            <button type="button" class="aiwb-asset-main" @click="downloadAsset(asset)">
              <span class="aiwb-asset-name">{{ asset.name }}</span>
              <span class="aiwb-asset-size">{{ formatSize(asset.size) }}</span>
            </button>
            <NTag size="small" :bordered="false" :type="extTagType(extOf(asset.name))">
              {{ extOf(asset.name) || '•' }}
            </NTag>
            <span class="aiwb-asset-url">{{ artifactUrl(asset) }}</span>
          </div>
          <div v-if="selectedRelease.assets.length === 0" class="aiwb-artifacts-empty">
            <NEmpty :description="t('aiwb-no-artifacts')" />
          </div>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.aiwb {
  padding: 20px 24px;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}
.aiwb-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.aiwb-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--m3-on-surface);
}
.aiwb-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--m3-on-surface-variant);
}
.aiwb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.aiwb-empty {
  padding: 60px 0;
}
.aiwb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.aiwb-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--task-item-bg, var(--m3-surface-container-lowest));
  border: 1px solid var(--m3-outline-variant);
  cursor: pointer;
  user-select: none;
  transition:
    border-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.aiwb-card:hover {
  border-color: var(--m3-primary);
}
.aiwb-card--active {
  border-color: var(--m3-primary);
  background: color-mix(in srgb, var(--m3-primary) 8%, var(--task-item-bg, var(--m3-surface-container-lowest)));
}
.aiwb-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.aiwb-card-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--m3-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aiwb-card-repo {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aiwb-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.aiwb-card-desc {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aiwb-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 260px;
  max-height: 60vh;
  overflow-y: auto;
}
.aiwb-detail-repo {
  font-size: 13px;
  color: var(--m3-on-surface-variant);
}
.aiwb-detail-loading,
.aiwb-detail-empty,
.aiwb-detail-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--m3-on-surface-variant);
}
.aiwb-releases {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.aiwb-release {
  display: flex;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container-lowest);
  cursor: pointer;
  transition: border-color 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.aiwb-release:hover {
  border-color: var(--m3-primary);
}
.aiwb-release--selected {
  border-color: var(--m3-primary);
}
.aiwb-release-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 130px;
  flex-shrink: 0;
}
.aiwb-release-tag {
  font-size: 14px;
  font-weight: 600;
  color: var(--m3-on-surface);
}
.aiwb-release-right {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.aiwb-release-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--m3-on-surface);
}
.aiwb-release-body {
  margin: 0;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--m3-on-surface-variant);
  white-space: pre-wrap;
  word-break: break-word;
}
.aiwb-installer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.aiwb-float-download {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 40;
  border-radius: 20px;
  box-shadow: var(--m3-elevation-2, 0 2px 6px rgba(0, 0, 0, 0.2));
}
.aiwb-artifacts {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.aiwb-artifacts-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.aiwb-artifacts-source-name {
  font-size: 12px;
  color: var(--m3-on-surface-variant);
}
.aiwb-asset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow-y: auto;
}
.aiwb-asset {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--m3-outline-variant);
  background: var(--m3-surface-container-lowest);
}
.aiwb-asset-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  flex: 1;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.aiwb-asset-main:hover .aiwb-asset-name {
  color: var(--m3-primary);
}
.aiwb-asset-name {
  font-size: 13px;
  color: var(--m3-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  transition: color 0.2s;
}
.aiwb-asset-size {
  font-size: 11px;
  color: var(--m3-on-surface-variant);
}
.aiwb-asset-url {
  font-size: 11px;
  color: var(--m3-on-surface-variant);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}
.aiwb-artifacts-empty {
  padding: 30px 0;
}
</style>
