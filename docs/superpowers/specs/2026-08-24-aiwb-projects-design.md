# Aiwb项目 页面 — 设计文档

日期：2026-08-24
模块：SeevvoDownloader 前端 + Rust 后端
状态：设计定稿

## 一句话

在 SeevvoDownloader 中新增「Aiwb项目」页面（`/aiwb`），固化收录希沃智慧黑板生态的 61 个桌面软件清单，按需拉取各仓库 GitHub Releases 展示版本/更新日志/产物资产，支持切换下载源（含链接速度）与「下载 exe 直接运行 / 下载 zip 静默安装」。

## 背景与目标

* 现有「软件中心」(`/software`) 是固化的希沃全家桶清单，下载走 aria2 任务。

* 目标：新增独立页面，覆盖更广的开源希沃生态软件（来自 awesome-iwb），做「版本浏览 + 产物下载安装」的统一入口。

* 复用现有能力：`useDownloadSource`（下载源/前缀）、`useSoftwareCatalog`（JSON 加载范式）、`taskStore.addUri`（aria2 下载）、`silentInstall` / `decompressArchive`（安装）、`fetch_remote_bytes` / `reqwest`（网络）、侧栏与路由范式。

## 数据清单

* 新增 `src/shared/aiwb-catalog.json`：内置 **60 个可拉取发行版的桌面软件**，字段：
  - `name`：显示名
  - `repo`：`owner/name`
  - `desc`：一句话简介（自行概括，不照抄 awesome-iwb README 原文）
  - 说明：awesome-iwb 分类中"屏幕批注/课表/工具"合计 61 个软件，其中 `TimerIn` 无 GitHub 仓库（仅官网 sr-studio.cn），无法在本页拉取 Releases/产物，故不纳入；其余 60 个均有真实 GitHub 仓库。

* 页面清单 = 内置 60 + **用户本地添加仓库**。

  * 用户可通过页面「添加仓库」输入 `owner/repo`。

  * 持久化到 `localStorage`，key 固定为 `seevvo-aiwb-custom-repos`，重启保留、仅本机生效，不改内置源文件。

## 后端命令（Rust）

新增 `src-tauri/src/commands/aiwb.rs`：

1. `fetch_github_releases(owner, repo) -> Vec<GitHubRelease>`

   * 请求 `https://api.github.com/repos/{owner}/{repo}/releases?per_page=5`

   * 需要 `User-Agent` 请求头（GitHub API 强制）

   * 复用显式代理配置（同现有 `http_client.rs` 的 `apply_explicit_proxy`）

   * 返回结构：

     * `tag_name`：版本号

     * `name`：Releases 标题

     * `body`：更新日志（Markdown 原文）

     * `prerelease`：是否预发布/测试版

     * `assets`：`[{ name, size, browser_download_url }]`

   * 带超时；解析出错返回可读错误。

2. `probe_http_head(url) -> u64`

   * 对该 URL 发一次 HEAD 请求，返回响应耗时（毫秒）。

   * 复用 reqwest，短超时（例如 5s），失败返回错误便于前端标记不可用。

3. 两个命令均注册进 `lib.rs` 的 `invoke_handler`。

4. `capabilities/default.json` 增加必要网络权限范围（仅当现有权限不足以发起请求时）。

## 前端

### 路由与入口

* `src/router/index.ts`：新增 `/aiwb` 路由 → `AiwbProjects.vue`。

* `src/components/layout/AsideBar.vue`：新增「Aiwb项目」图标入口（软件中心图标组内）。

### 数据访问 composable

* `useAiwbCatalog.ts`：

  * 读取 `aiwb-catalog.json`（内置 61）

  * 读取 localStorage 用户仓库，合并生成清单；提供 `addRepo` / `removeRepo`。

  * 分类（可选，暂按单一列表展示；若内置清单自带分类则沿用）。

* `useGitHubReleases.ts`：

  * `fetchReleases(owner, repo)` 封装 invoke `fetch_github_releases`

  * 内存/带 TTL 的轻缓存，避免重复拉取与限流。

  * `probeSource(url)` 封装 invoke `probe_http_head`。

### 页面 `AiwbProjects.vue`

* **卡片列表**：每个项目显示名称、仓库、简介。数据来自内置 + 用户添加。

* **点卡片 → 按需拉取**该仓库 releases（进入该项目的详情态），不预拉全部（限流安全）。

* **版本列表「左右布局」**：

  * 左列：版本号（tag），版本号旁显示通道徽标：

    * `prerelease == false` → `正式版`

    * `prerelease == true`，且 `tag_name`/`body` 含 `beta`/`rc`/`preview` 等关键字 → `测试版(beta/RC)`；否则 → `测试版`

  * 右上：Releases 标题（`name`）

  * 右下：更新日志（`body`，Markdown 预览）

* **悬浮下载按钮**：随当前选中版本固定悬浮。

  * 点击 → 弹出**产物弹窗**。

* **产物弹窗**：

  * 顶部：**下载源下拉**，每项显示源名 + **链接速度**（HEAD 延迟 ms，可「重新测速」）。打开弹窗时对当前源测一次。

  * 主体：该版本 `assets` 列表，每项显示文件名、大小、**类型尾缀徽标**（exe / zip / msi / dmg / deb 等，按扩展名推断）。

  * 无资产的发布版显示提示。

### 产物点击逻辑

* 下载地址：

  * 来源资产 `browser_download_url` 形如 `https://github.com/{owner}/{repo}/releases/download/{tag}/{file}`

  * 用当前下载源前缀拼接加速 URL（复用 `useDownloadSource` 的 prefix）。

* **exe / 可执行**：`taskStore.addUri` 添加 aria2 下载任务（保存到**下载路径**）→ 下载完成事件 → 直接运行该 exe。

* **zip / 压缩包**：

  * 添加到 `taskStore.addUri`（下载路径）

  * 下载完成后解压到**静默安装路径**（本次可在弹窗里下拉调整，默认读设置）

  * 解压目录内若存在多个安装程序（exe/msi）→ 弹出下拉框选择 → `silentInstall`

### 设置（preference）

* 新增两个独立配置项：

  * `aiwbDownloadDir`：**默认下载路径**（产物保存地），默认 `{下载目录}/aiwb`

  * `aiwbInstallDir`：**静默安装路径**（zip 解压地），默认 `{下载目录}/aiwb/install`

* 在设置页新增分组（放在常规或高级分区），可编辑。

## 限流 / 错误 / 测试

* 限流：按需单仓库拉取 + `per_page=5` + 前端 TTL 缓存；不做全量并发预拉。

* 错误：GitHub 限流（403/429）、网络失败、仓库不存在 → 显示错误 + 重试按钮；产物弹窗下载源测速失败标记不可用。

* 测试：

  * Rust：`fetch_github_releases` 的 JSON 解析与资产提取单测；`probe_http_head` 单元测试；加速 URL 拼接逻辑测试。

  * 前端：`useAiwbCatalog`（内置+用户合并、addRepo/removeRepo）、`useGitHubReleases`（缓存、测速封装）composable 测试。

## 非目标

* 不做全量预拉所有仓库 Releases。

* 不做 GitHub OAuth / 认证（不提升 API 限流）。

* 不把用户添加的仓库写回内置 `aiwb-catalog.json`（仅本地持久化）。

* 不复制 awesome-iwb README 文案进内置清单（desc 自行概括）。

