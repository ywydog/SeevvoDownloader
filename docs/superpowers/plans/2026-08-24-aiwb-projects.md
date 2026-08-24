# Aiwb项目 页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SeevvoDownloader 新增 `Aiwb项目` 页面，固化收录 61 个希沃生态软件的仓库清单，按需拉取 GitHub Releases（版本/更新日志/产物），支持下载源切换+测速，并能「exe 直接运行 / zip 解压后静默安装」。

**Architecture:** 前端页面 + 三个新 composable（目录、Releases 拉取缓存、下载编排）+ 内置 JSON 清单；Rust 新增 `commands/aiwb.rs` 提供 GitHub Releases 拉取与 HEAD 测速两个 Tauri 命令，复用现有 reqwest/代理/preference 体系；设置新增「下载路径」「静默安装路径」两个配置项。

**Tech Stack:** Vue 3 + Vite + TypeScript（vitest）、Tauri 2 / Rust（reqwest、serde、thiserror）、Naive UI。

***

## 前置命令速查

* 后端测试（在 `src-tauri` 目录）：`cargo test`

* 后端检查：`cargo check`

* 前端测试（项目根）：`pnpm test`

* 前端构建：`pnpm build`

* 约定：每完成一个任务即 `git add` 并提交，作者 `ywydog <ywydog@users.noreply.github.com>`，中文提交信息。
  例：`git add <files> && git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: ..."`

***

### Task 1: Rust 后端 — GitHub Releases 与 HEAD 测速命令

**Files:**

* Create: `src-tauri/src/commands/aiwb.rs`

* Modify: `src-tauri/src/commands/mod.rs`

* Modify: `src-tauri/src/lib.rs`（invoke\_handler 注册）

* Test: `src-tauri/src/commands/aiwb.rs`（模块内 `#[cfg(test)]`）

* [ ] **Step 1: 编写失败的单测**

`src-tauri/src/commands/aiwb.rs`:

```rust
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
// GitHub API 返回 snake_case 字段，反序列化用 snake_case；前端期望 camelCase，序列化用 camelCase。
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

fn split_repo(repo: &str) -> Result<(String, String), AppError> {
    let mut it = repo.trim().split('/');
    let owner = it.next().unwrap_or("").trim().to_string();
    let name = it.next().unwrap_or("").trim().to_string();
    // 必须严格为 owner/name 两段，多余分段视为非法。
    if owner.is_empty() || name.is_empty() || it.next().is_some() {
        return Err(AppError::Io(format!("仓库格式应为 owner/repo，实际为: {repo}")));
    }
    Ok((owner, name))
}

/// 请求 GitHub Releases API（未认证，未限制 60 次/小时）。
/// `proxy` 复用系统的显式代理配置。
#[tauri::command]
pub async fn fetch_github_releases(
    repo: String,
    proxy: Option<String>,
) -> Result<Vec<GitHubRelease>, AppError> {
    let (owner, name) = split_repo(&repo)?;
    let url = format!("https://api.github.com/repos/{owner}/{name}/releases?per_page=5&order=desc");

    let builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5));
    let client = crate::commands::http_client::apply_explicit_proxy(
        builder,
        &proxy,
        "fetch_github_releases",
    )
    .build()
    .map_err(|e| AppError::Io(format!("GitHub client 初始化失败: {e}")))?;

    let resp = client
        .get(&url)
        .header("User-Agent", "SeevvoDownloader")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Io(format!("GitHub 请求失败: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Io(format!(
            "GitHub API 返回 HTTP {}（可能是仓库不存在或触发限流）",
            resp.status().as_u16()
        )));
    }

    resp.json::<Vec<GitHubRelease>>()
        .await
        .map_err(|e| AppError::Io(format!("解析 GitHub Releases 失败: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_releases_json() -> &'static str {
        r#"[
          {
            "tag_name": "v1.2.0",
            "name": "v1.2.0",
            "body": "修复若干问题",
            "prerelease": false,
            "assets": [
              { "name": "app.exe", "size": 1024, "browser_download_url": "https://github.com/o/r/releases/download/v1.2.0/app.exe" }
            ]
          },
          {
            "tag_name": "v1.1.0-rc.1",
            "name": "RC 1",
            "body": "测试发布",
            "prerelease": true,
            "assets": []
          }
        ]"#
    }

    #[test]
    fn parses_releases_and_assets() {
        let releases: Vec<GitHubRelease> =
            serde_json::from_str(sample_releases_json()).expect("parse");
        assert_eq!(releases.len(), 2);
        assert_eq!(releases[0].tag_name, "v1.2.0");
        assert!(!releases[0].prerelease);
        assert_eq!(releases[0].assets[0].name, "app.exe");
        assert_eq!(releases[0].assets[0].size, 1024);
        assert!(releases[1].prerelease);
        assert!(releases[1].assets.is_empty());
    }

    #[test]
    fn missing_fields_default_to_empty() {
        let json = r#"[{"tag_name":"v1.0.0"}]"#;
        let releases: Vec<GitHubRelease> = serde_json::from_str(json).expect("parse");
        assert_eq!(releases[0].name, "");
        assert!(!releases[0].prerelease);
        assert!(releases[0].assets.is_empty());
    }

    #[test]
    fn split_repo_accepts_valid_owner_name() {
        let (o, n) = split_repo("WXRIW/Ink-Canvas").expect("split");
        assert_eq!(o, "WXRIW");
        assert_eq!(n, "Ink-Canvas");
    }

    #[test]
    fn split_repo_rejects_invalid() {
        assert!(split_repo("").is_err());
        assert!(split_repo("onlyowner").is_err());
        assert!(split_repo("a/b/c").is_err());
    }
}
```

* [ ] **Step 2: 运行测试，确认失败**

Run（在 `src-tauri`）: `cargo test`
Expected: FAIL — 编译错误 `cannot find module aiwb`（/mod 未声明），或测试函数不存在。

* [ ] **Step 3: 注册模块**

`src-tauri/src/commands/mod.rs` 增加两行（按字母序放在 updater 之前）:

```rust
pub mod aiwb;
pub mod updater;
```

`mod.rs` 的 `pub use` 中增加（`pub use aria2::*;` 之前）:

```rust
pub use aiwb::*;
```

* [ ] **Step 4: 注册 invoke\_handler**

在 `src-tauri/src/lib.rs` 的 `invoke_handler` 列表（`commands::fetch_remote_bytes,` 附近）加入：

```rust
            commands::fetch_github_releases,
            commands::probe_http_head,
```

* [ ] **Step 5: 实现 probe\_http\_head**

在 `aiwb.rs` 的 `fetch_github_releases` 之后、`#[cfg(test)]` 之前加入：

```rust
/// 对目标 URL 发 HEAD 请求，返回响应耗时（毫秒）。复用显式代理设置。
/// 用于下载源「链接速度」展示。任何错误（失败/超时）由前端据此判定该源不可用。
#[tauri::command]
pub async fn probe_http_head(url: String, proxy: Option<String>) -> Result<u64, AppError> {
    let builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5));
    let client = crate::commands::http_client::apply_explicit_proxy(builder, &proxy, "probe_http_head")
        .build()
        .map_err(|e| AppError::Io(format!("probe client 初始化失败: {e}")))?;

    let started = std::time::Instant::now();
    let resp = client
        .head(&url)
        .header("User-Agent", "SeevvoDownloader")
        .send()
        .await
        .map_err(|e| AppError::Io(format!("探测失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Io(format!("探测返回 HTTP {}", resp.status().as_u16())));
    }
    // 不等待 body（HEAD 无 body），直接用已用时间
    Ok(started.elapsed().as_millis() as u64)
}
```

* [ ] **Step 6: 运行测试，确认通过**

Run（在 `src-tauri`）: `cargo test`
Expected: PASS（含新增 4 条 aiwb 单测）；`cargo check` 无警告。

* [ ] **Step 7: 提交**

```bash
git add src-tauri/src/commands/aiwb.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat(backend): 新增 GitHub Releases 拉取与下载源测速命令"
```

***

### Task 2: 内置清单 aiwb-catalog.json

**Files:**

* Create: `src/shared/aiwb-catalog.json`

* Test: `src/composables/__tests__/useAiwbCatalog.test.ts`（在 Task 4 一起写）

* [ ] **Step 1: 创建清单**

`src/shared/aiwb-catalog.json`（60 条；`repo` 为 `owner/name`；`category` ∈ `白板/课表/工具`；`desc` 为自行概括的短描述。**共 60 条**：白板 10 + 课表 22 + 工具 28；`TimerIn` 因无 GitHub 仓库不纳入）：

```json
[
  { "name": "Ink Canvas", "repo": "WXRIW/Ink-Canvas", "category": "白板", "desc": "轻量屏幕批注画板，针对希沃一体机优化" },
  { "name": "Ink Canvas Plus", "repo": "clover-yan/Ink-Canvas-Plus", "category": "白板", "desc": "IC 复刻增强版 Windows 画板应用" },
  { "name": "Ink Canvas Artistry", "repo": "InkCanvas/Ink-Canvas-Artistry", "category": "白板", "desc": "IC 优化版，增加荧光笔与图片插入" },
  { "name": "智绘教 Inkeys", "repo": "Alan-CRL/Inkeys", "category": "白板", "desc": "高性能丝滑画笔的屏幕批注软件" },
  { "name": "ICC-CE", "repo": "InkCanvasForClass/community", "category": "白板", "desc": "教学批注社区版，多画笔与图层管理" },
  { "name": "ICC-Re", "repo": "LiuYan-xwx/InkCanvasForClass-Remastered", "category": "白板", "desc": "教学批注重构增强版" },
  { "name": "ppInk", "repo": "pubpub-zz/ppInk", "category": "白板", "desc": "支持数位板压感的桌面批注软件" },
  { "name": "Ink Canvas Better", "repo": "ThreeMonthAgo/Ink_Canvas_Better", "category": "白板", "desc": "基于 ICA 的 Windows 画板，专注绘图" },
  { "name": "ShowWrite 视频展台", "repo": "SECTL/ShowWrite", "category": "白板", "desc": "视频展台/直播教学，含批注与录制" },
  { "name": "LanStartWrite", "repo": "wwiinnddyy/LanStartWrite", "category": "白板", "desc": "Electron 高性能画布书写应用" },
  { "name": "ClassIsland", "repo": "ClassIsland/ClassIsland", "category": "课表", "desc": "智慧屏课表信息显示，含上课提醒与插件" },
  { "name": "ZongziTEK 黑板贴", "repo": "ZongziTEK/ZongziTEK-Blackboard-Sticker", "category": "课表", "desc": "白板桌面小部件：小黑板/课表/天气" },
  { "name": "StickyHomeworks2", "repo": "StickyHomeworks2/StickyHomeworks2", "category": "课表", "desc": "支持富文本的桌面作业贴" },
  { "name": "考试看板 Legacy", "repo": "ExamAware/ExamShowboard-Legacy", "category": "课表", "desc": "跨平台考试时间展示看板" },
  { "name": "Class Widgets", "repo": "Class-Widgets/Class-Widgets", "category": "课表", "desc": "教学进度桌面组件，插件广场与主题" },
  { "name": "凌云班级组件", "repo": "Yamikani-Flipped/LingYun-Class-Widgets", "category": "课表", "desc": "班级桌面工具：时间/值日/课程" },
  { "name": "Education Clock", "repo": "Return-Log/Education-Clock", "category": "课表", "desc": "班级信息看板：倒计时/时钟/课表" },
  { "name": "ClassBoard", "repo": "Candlest/ClassBoard", "category": "课表", "desc": "教学信息桌面壁纸，兼容希沃老设备" },
  { "name": "Ris ClassTool", "repo": "Ris-Soft/Ris_ClassTool", "category": "课表", "desc": "教学一体机多功能看板与侧边栏" },
  { "name": "CountBoard", "repo": "Gaoyongxian666/CountBoard", "category": "课表", "desc": "桌面日程倒计时应用，亚克力毛玻璃" },
  { "name": "ElectronClassSchedule", "repo": "EnderWolf006/ElectronClassSchedule", "category": "课表", "desc": "显示课表/周次/倒计时的电子课表" },
  { "name": "ClassTools", "repo": "clansty/ClassTools", "category": "课表", "desc": "动态壁纸式教室系统，高考倒计时等" },
  { "name": "StickyHomeworks", "repo": "HelloWRC/StickyHomeworks", "category": "课表", "desc": "富文本桌面作业贴，按科目分组" },
  { "name": "Sticky-attention", "repo": "Sticky-attention/Sticky-attention", "category": "课表", "desc": "Windows 教室作业显示工具" },
  { "name": "ClassPaper", "repo": "E7G/Classpaper-v4", "category": "课表", "desc": "Rust 桌面课程表/壁纸/告示牌应用" },
  { "name": "考试语音播报系统", "repo": "cloudy059/ExamBroadcast", "category": "课表", "desc": "支持语音播报的考试看板" },
  { "name": "iClass", "repo": "gpuawa/iClass", "category": "课表", "desc": "教室大屏实用工具箱含课表" },
  { "name": "ExamClock", "repo": "L33Z22L11/ExamClock", "category": "课表", "desc": "展示科目/起止时间/进度的考试时钟" },
  { "name": "Zooni", "repo": "Xwei1645/Zooni", "category": "课表", "desc": "教室大屏作业看板" },
  { "name": "ElectronClassScheduleX", "repo": "Enigfrank/ElectronClassScheduleX", "category": "课表", "desc": "基于 ECS 魔改的电子课表" },
  { "name": "每日作业面板", "repo": "BearWhite-Z/Daily-Commission-Panel", "category": "课表", "desc": "简洁的作业展示/布置/管理工具" },
  { "name": "LanMountainDesktop", "repo": "wwiinnddyy/LanMountainDesktop", "category": "课表", "desc": "把桌面变成可编排信息空间的壳层" },
  { "name": "PPT 触屏辅助", "repo": "RinLit-233-shiroko/PowerPoint-Touch-Assist", "category": "工具", "desc": "PPT 单点翻页触屏辅助" },
  { "name": "全能班辅", "repo": "XeonMEMZ/qnbf6", "category": "工具", "desc": "值日/点名/自定义课表小工具" },
  { "name": "OpenLuckyRandom", "repo": "WhatDamon/OpenLuckyRandom", "category": "工具", "desc": "仿希沃人脸识别随机抽人工序" },
  { "name": "MythwareToolkit", "repo": "BengbuGuards/MythwareToolkit", "category": "工具", "desc": "极域/机房管理助手控制工具箱" },
  { "name": "ClassNamePicker", "repo": "Chengzi600/ClassNamePicker", "category": "工具", "desc": "课堂随机点名，支持男女/去重/统计" },
  { "name": "SectionIstool", "repo": "SECTL/SectionIstool", "category": "工具", "desc": "班级电脑下载软件的小工具" },
  { "name": "CountDownControl", "repo": "cjhdevact/CountDownControl", "category": "工具", "desc": "高度自定义的倒计时小工具" },
  { "name": "LockTime", "repo": "cjhdevact/LockTime", "category": "工具", "desc": "深/浅色时钟锁屏屏保" },
  { "name": "UsefulControl", "repo": "cjhdevact/UsefulControl", "category": "工具", "desc": "大屏电脑工具整合包" },
  { "name": "Rand 抽号器", "repo": "LuoYunXi0407/Rand", "category": "工具", "desc": "触摸屏优化的抽号软件" },
  { "name": "NamePicker", "repo": "NamePickerOrg/NamePicker", "category": "工具", "desc": "支持自定义规则的在线点名软件" },
  { "name": "SecRandom", "repo": "SECTL/SecRandom", "category": "工具", "desc": "多人/小组/性别/语音提示的随机抽取" },
  { "name": "RandPicker", "repo": "xuanxuan1231/RandPicker", "category": "工具", "desc": "简单易用的随机抽取工具" },
  { "name": "SeewoSplash", "repo": "fengyec2/custom-seewo-splash-screen", "category": "工具", "desc": "自定义希沃白板/WPS 启动图工具" },
  { "name": "Class-Scoring-Program", "repo": "andycey/Class-Scoring-Program", "category": "工具", "desc": "统计班级量化积分的程序" },
  { "name": "360 拖堂卫士", "repo": "BSOD-MEMZ/360-Class-Guard", "category": "工具", "desc": "防拖堂，下课弹窗可强制关软件" },
  { "name": "教室座位安排系统", "repo": "xi-guang1/SeatsChanger", "category": "工具", "desc": "图形化教室排座工具" },
  { "name": "ClassAware", "repo": "unDefFtr/ClassAware", "category": "工具", "desc": "Flutter 跨平台电子班牌 APP" },
  { "name": "学生任务分配系统", "repo": "VacuolePaoo/stu-task-generate", "category": "工具", "desc": "课堂任务分配工具" },
  { "name": "Class-Roster-Picker-NEXT", "repo": "Yish1/Class-Roster-Picker-NEXT", "category": "工具", "desc": "课堂点名工具" },
  { "name": "蓝屏抽奖机", "repo": "Lanpinggai666/lanpingChouJiang", "category": "工具", "desc": "置顶屏幕侧面的课堂点名抽奖" },
  { "name": "考试倒计时桌面小工具", "repo": "Zpcin/ExaminationCountdown", "category": "工具", "desc": "中考/高考剩余时间桌面倒计时" },
  { "name": "Luminalium", "repo": "SECTL/Luminalium", "category": "工具", "desc": "演示软件上的轻量批注工具" },
  { "name": "ClassWindow", "repo": "xinghai-smartedu/classwindow", "category": "工具", "desc": "班级桌面悬浮窗信息显示" },
  { "name": "ClassScreenLock", "repo": "ClassScreenLock/ClassScreenLock", "category": "工具", "desc": "防止学生课后乱动电脑的屏幕锁" },
  { "name": "SidebarForClass", "repo": "PANDAJSR/sidebar-for-class", "category": "工具", "desc": "班级大屏侧边栏应用" },
  { "name": "SeatingChartEditor2", "repo": "Braydenccc/SeatingChartEditor2", "category": "工具", "desc": "跨平台现代化座位表编辑器" },
  { "name": "随机点名 Plus 3", "repo": "Macrohard0001/Random_Choice_Plus_3", "category": "工具", "desc": "PyGame 课堂点名，多模式与概率调整" }
]
```

* [ ] **Step 2: 校验 JSON 合法**

Run（项目根）: `node -e "JSON.parse(require('fs').readFileSync('src/shared/aiwb-catalog.json','utf8')); console.log(JSON.parse(require('fs').readFileSync('src/shared/aiwb-catalog.json','utf8')).length)"`
Expected: 打印 `61`，无报错。

* [ ] **Step 3: 提交**

```bash
git add src/shared/aiwb-catalog.json
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: 新增 Aiwb 内置项目清单（61 个软件）"
```

> 说明：该清单的 `desc` 为自概括。若后续用户要求补充/调整条目，直接改此 JSON 即可。

***

### Task 3: 前端 composable — useGitHubReleases

**Files:**

* Create: `src/composables/useGitHubReleases.ts`

* Create: `src/composables/__tests__/useGitHubReleases.test.ts`

* [ ] **Step 1: 编写失败测试**

`src/composables/__tests__/useGitHubReleases.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGitHubReleases } from '@/composables/useGitHubReleases'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

beforeEach(() => invokeMock.mockReset())

describe('useGitHubReleases', () => {
  it('返回拉取到的 releases，并带缓存命中标记', async () => {
    const payload = [
      { tagName: 'v1.2.0', name: 'v1.2.0', body: 'x', prerelease: false, assets: [{ name: 'a.exe', size: 1, browserDownloadUrl: 'https://g/a.exe' }] },
    ]
    invokeMock.mockResolvedValue(payload)
    invokeMock.mockResolvedValueOnce(payload)

    const r = useGitHubReleases()
    const first = await r.fetchReleases('o/r', { proxy: null })
    expect(first.data).toHaveLength(1)
    expect(first.cached).toBe(false)

    const second = await r.fetchReleases('o/r', { proxy: null })
    expect(second.data).toHaveLength(1)
    expect(second.cached).toBe(true)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('拉取失败时返回错误的可读信息', async () => {
    invokeMock.mockRejectedValue({ Engine: 'boom' })
    const r = useGitHubReleases()
    const res = await r.fetchReleases('o/r', { proxy: null })
    expect(res.error).toBeTruthy()
    expect(res.data).toEqual([])
  })

  it('probe 返回源延迟结果或失败哨兵', async () => {
    invokeMock.mockResolvedValue(238)
    const r = useGitHubReleases()
    const ms = await r.probeSource('https://x')
    expect(ms).toBe(238)
  })
})
```

* [ ] **Step 2: 运行测试，确认失败**

Run（项目根）: `pnpm exec vitest run src/composables/__tests__/useGitHubReleases.test.ts`
Expected: FAIL — `Cannot find module '@/composables/useGitHubReleases'`。

* [ ] **Step 3: 实现 composable**

`src/composables/useGitHubReleases.ts`:

```ts
/** GitHub Releases 拉取与下载源测速封装（带 TTL 内存缓存，避免触发限流）。 */
import { invoke } from '@tauri-apps/api/core'

export interface GitHubAsset {
  name: string
  size: number
  browserDownloadUrl: string
}

export interface GitHubRelease {
  tagName: string
  name: string
  body: string
  prerelease: boolean
  assets: GitHubAsset[]
}

export interface ProbeOptions {
  proxy: string | null
}

interface CacheEntry {
  data: GitHubRelease[]
  expiresAt: number
}

const PREROLL_TTL_MS = 10 * 60 * 1000 // 10 分钟

const releaseCache = new Map<string, CacheEntry>()

/** 缓存键 = owner/repo */
function cacheKey(repo: string): string {
  return repo.toLowerCase()
}

export function useGitHubReleases() {
  async function fetchReleases(
    repo: string,
    opts: ProbeOptions,
  ): Promise<{ data: GitHubRelease[]; error: string | null; cached: boolean }> {
    const key = cacheKey(repo)
    const hit = releaseCache.get(key)
    if (hit && hit.expiresAt > Date.now()) {
      return { data: hit.data, error: null, cached: true }
    }

    try {
      const data = await invoke<GitHubRelease[]>('fetch_github_releases', { repo, proxy: opts.proxy })
      releaseCache.set(key, { data, expiresAt: Date.now() + PREROLL_TTL_MS })
      return { data, error: null, cached: false }
    } catch (e) {
      const msg = typeof e === 'object' && e !== null
        ? JSON.stringify(e)
        : String(e ?? '未知错误')
      return { data: [], error: msg, cached: false }
    }
  }

  async function probeSource(url: string, opts: ProbeOptions): Promise<number | null> {
    try {
      return await invoke<number>('probe_http_head', { url, proxy: opts.proxy })
    } catch {
      return null
    }
  }

  return { fetchReleases, probeSource }
}
```

* [ ] **Step 4: 运行测试，确认通过**

Run（项目根）: `pnpm exec vitest run src/composables/__tests__/useGitHubReleases.test.ts`
Expected: PASS（3 条）。

* [ ] **Step 5: 提交**

```bash
git add src/composables/useGitHubReleases.ts src/composables/__tests__/useGitHubReleases.test.ts
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: useGitHubReleases 封装（缓存+测速）"
```

***

### Task 4: 前端 composable — useAiwbCatalog

**Files:**

* Create: `src/composables/useAiwbCatalog.ts`

* Create: `src/composables/__tests__/useAiwbCatalog.test.ts`

* [ ] **Step 1: 编写失败测试**

`src/composables/__tests__/useAiwbCatalog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAiwbCatalog } from '@/composables/useAiwbCatalog'

const CUSTOM_KEY = 'seevvo-aiwb-custom-repos'
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => {
  localStorageMock.getItem.mockReset()
  localStorageMock.setItem.mockReset()
})

describe('useAiwbCatalog', () => {
  it('清单 = 内置 60 + 用户添加仓库', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['Me/UserRepo']))
    const { all } = useAiwbCatalog()
    expect(all.value.length).toBeGreaterThanOrEqual(60)
    expect(all.value.some((x) => x.name === 'ClassIsland')).toBe(true)
    expect(all.value.some((x) => x.repo === 'Me/UserRepo')).toBe(true)
  })

  it('addRepo 写入 localStorage 并反映在清单里', () => {
    localStorageMock.getItem.mockReturnValue(null)
    const { addRepo, all } = useAiwbCatalog()
    addRepo('Owner/RepoName')
    const saved = JSON.parse((localStorageMock.setItem.mock.calls.at(-1)?.[1] as string) ?? '[]')
    expect(saved).toContain('Owner/RepoName')
    expect(all.value.some((x) => x.repo === 'Owner/RepoName')).toBe(true)
  })

  it('removeRepo 移除用户仓库', () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(['A/B', 'C/D']))
    const { removeRepo, all } = useAiwbCatalog()
    removeRepo('A/B')
    expect(all.value.some((x) => x.repo === 'A/B')).toBe(false)
    expect(all.value.some((x) => x.repo === 'C/D')).toBe(true)
  })

  it('忽略非 owner/name 格式的添加', () => {
    localStorageMock.getItem.mockReturnValue(null)
    const { addRepo, all } = useAiwbCatalog()
    const ok = addRepo('notAValidRepo')
    expect(ok).toBe(false)
    expect(all.value.filter((x) => !builtinRepos.has(x.repo)).length).toBe(0)
  })
})
```

> 说明：测试引用了 `builtinRepos`（一个 `Set<string>`）。为避免测试与实现强耦合，把它定义在 composable 内部并导出。

* [ ] **Step 2: 运行测试，确认失败**

Run（项目根）: `pnpm exec vitest run src/composables/__tests__/useAiwbCatalog.test.ts`
Expected: FAIL — 模块不存在。

* [ ] **Step 3: 实现 composable**

`src/composables/useAiwbCatalog.ts`:

```ts
/** Aiwb 项目清单：内置 JSON + 用户本地添加仓库（localStorage 持久化）。 */
import { computed, ref } from 'vue'
import catalogData from '@shared/aiwb-catalog.json'

export interface AiwbEntry {
  name: string
  repo: string // owner/name
  category: '白板' | '课表' | '工具'
  desc: string
  // 用户自加项为 true
  custom?: boolean
}

export const CUSTOM_REPOS_KEY = 'seevvo-aiwb-custom-repos'

export const builtinRepos = new Set<string>()

function loadBuiltin(): AiwbEntry[] {
  const list = (catalogData as AiwbEntry[]) ?? []
  list.forEach((e) => builtinRepos.add(e.repo.toLowerCase()))
  return list
}

function loadCustomRepos(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_REPOS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    /* ignore */
  }
  return []
}

function isOwnerRepo(s: string): boolean {
  const parts = s.trim().split('/')
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
}

export function useAiwbCatalog() {
  const builtin = loadBuiltin()
  const customRepos = ref<string[]>(loadCustomRepos())

  const all = computed<AiwbEntry[]>(() => {
    const base: AiwbEntry[] = builtin.map((e) => ({ ...e }))
    for (const repo of customRepos.value) {
      const key = repo.toLowerCase()
      if (builtinRepos.has(key)) continue // 避免与内置重复
      base.push({ name: repo.split('/')[1], repo, category: '工具', desc: '用户自添加仓库', custom: true })
    }
    return base
  })

  function persist(repos: string[]) {
    try {
      localStorage.setItem(CUSTOM_REPOS_KEY, JSON.stringify(repos))
    } catch { /* ignore */ }
  }

  function addRepo(repo: string): boolean {
    if (!isOwnerRepo(repo)) return false
    const normalized = repo.trim()
    const key = normalized.toLowerCase()
    if (builtinRepos.has(key) || customRepos.value.some((r) => r.toLowerCase() === key)) return false
    customRepos.value = [...customRepos.value, normalized]
    persist(customRepos.value)
    return true
  }

  function removeRepo(repo: string) {
    customRepos.value = customRepos.value.filter((r) => r.toLowerCase() !== repo.toLowerCase())
    persist(customRepos.value)
  }

  return { all, builtin, addRepo, removeRepo, isOwnerRepo }
}
```

> 注意：`@shared/aiwb-catalog.json` 需要能被 TS 导入。确认同一目录下的 `software-catalog.json` 有对应 d.ts 声明（`src/shared/locales` 等用 `@shared/...`）。若 TS 报缺少声明，在 `src/types` 增加一个 `declare module '@shared/aiwb-catalog.json'`（参考现有 software-catalog 的处理方式）。

* [ ] **Step 4: 运行测试，确认通过**

Run（项目根）: `pnpm exec vitest run src/composables/__tests__/useAiwbCatalog.test.ts`
Expected: PASS（4 条）。

* [ ] **Step 5: 提交**

```bash
git add src/composables/useAiwbCatalog.ts src/composables/__tests__/useAiwbCatalog.test.ts
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: useAiwbCatalog（内置+用户自加仓库）"
```

***

### Task 5: 设置项 — 下载路径 / 静默安装路径

**Files:**

* Modify: `src/shared/constants.ts`（`DEFAULT_APP_CONFIG` 增加两字段）

* Modify: `src/shared/types.ts`（`AppConfig` 增加两字段）

* Modify: `src/shared/configKeys.ts`

* Modify: `src/shared/utils/configHydration.ts`

* Modify: `src/components/preference/Advanced.vue`（新增分组展示）

* 测试：随 Task 5 在现有测试中补充两字段断言

* [ ] **Step 1: 找到配置定义模式**

先在 `src/shared/constants.ts` 找到 `DEFAULT_APP_CONFIG` 里一个字符串字段（如 `dir`），`src/shared/types.ts` 的 `AppConfig`，`src/shared/configKeys.ts` 的键数组，以及 `configHydration.ts` 的默认合并逻辑，确认真实行号后按同样的写法追加。

* [ ] **Step 2: 增加字段（合并两个默认值）**

在 `DEFAULT_APP_CONFIG`（`src/shared/constants.ts`）增加：

```ts
  /** Aiwb 产物默认下载目录（相对下载目录的子目录语义，由前端拼接） */
  aiwbDownloadDir: 'aiwb',
  /** Aiwb zip 静默安装解压目录 */
  aiwbInstallDir: 'aiwb/install',
```

在 `src/shared/types.ts` 的 `AppConfig` 对应位置增加同名字段（类型 `string`）。

在 `src/shared/configKeys.ts` 的可用键数组增加 `'aiwbDownloadDir'` 与 `'aiwbInstallDir'`。

* [ ] **Step 3: 确认 hydration 默认合并无须额外逻辑**

`configHydration.ts` 通过 `clonePlain(DEFAULT_APP_CONFIG)` 打底，新字段会自动带上默认值，无需额外写分支。若测试断言了配置结构，确认更新相关断言。

* [ ] **Step 4: 设置页 UI（Advanced.vue）**

在 `src/components/preference/Advanced.vue` 新增一个分组「Aiwb」共享解压/下载目录，参考文件内已有的输入框（`NDynamicInput` / `NInput`）写法：

```vue
<div class="pref-block">
  <PreferenceHintLabel :label="t('preferences.aiwb-download-dir')" />
  <div class="pref-row">
    <NInput v-model:value="form.aiwbDownloadDir" />
  </div>
</div>
<div class="pref-block">
  <PreferenceHintLabel :label="t('preferences.aiwb-install-dir')" />
  <div class="pref-row">
    <NInput v-model:value="form.aiwbInstallDir" />
  </div>
</div>
```

> 提示：`PreferenceHintLabel` 与 `NInput` 需确认已在 Advanced.vue 中引入（沿用该文件现有结构）；其 `form` 来自该页面的 preference composable。如何在 `useAdvancedPreference.ts` 里加入这两个字段的默认/读取/还原逻辑，请仿照该文件现有字段（如 `split`）的 `buildXxxForm` / `transformXxxForStore` 模式补充，并更新 `useAdvancedPreference.test.ts` 的对应用例（默认值断言 + 往返转换保留）。

* [ ] **Step 5: 运行前端测试**

Run（项目根）: `pnpm test`
Expected: PASS。若新增断言失败，按报错补齐 `useAdvancedPreference.ts` / 测试的字段映射。

* [ ] **Step 6: 提交**

```bash
git add src/shared/constants.ts src/shared/types.ts src/shared/configKeys.ts src/components/preference/Advanced.vue src/composables/useAdvancedPreference.ts src/composables/__tests__/useAdvancedPreference.test.ts
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: 新增 Aiwb 下载路径与静默安装路径设置项"
```

***

### Task 6: 前端 composable — useAiwbDownload（下载编排）

**Files:**

* Create: `src/composables/useAiwbDownload.ts`

* Create: `src/composables/__tests__/useAiwbDownload.test.ts`

* [ ] **Step 1: 编写失败测试**

`src/composables/__tests__/useAiwbDownload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildAcceleratedUrl, assetExtension, isExecutableExt, isArchiveExt } from '@/composables/useAiwbDownload'

describe('useAiwbDownload 纯函数', () => {
  const PREFIX = 'https://hk.gh-proxy.org/https://github.com'
  const DOWNLOAD_URL = 'https://github.com/o/r/releases/download/v1/app.exe'

  it('buildAcceleratedUrl 用下载源前缀包裹 GitHub 资产地址', () => {
    expect(buildAcceleratedUrl(DOWNLOAD_URL, PREFIX)).toBe(`${PREFIX}${DOWNLOAD_URL}`)
  })

  it('buildAcceleratedUrl 对非 github 直链原样返回', () => {
    expect(buildAcceleratedUrl('https://other.com/a.zip', PREFIX)).toBe('https://other.com/a.zip')
  })

  it('assetExtension 取小写扩展名', () => {
    expect(assetExtension('App.Exe')).toBe('exe')
    expect(assetExtension('noext')).toBe('')
  })

  it('isExecutableExt / isArchiveExt 判定', () => {
    expect(isExecutableExt('exe')).toBe(true)
    expect(isExecutableExt('msi')).toBe(true)
    expect(isExecutableExt('zip')).toBe(false)
    expect(isArchiveExt('zip')).toBe(true)
    expect(isArchiveExt('7z')).toBe(true)
  })
})
```

* [ ] **Step 2: 运行测试，确认失败**

Run（项目根）: `pnpm exec vitest run src/composables/__tests__/useAiwbDownload.test.ts`
Expected: FAIL — 模块不存在。

* [ ] **Step 3: 实现 composable（含下载编排）**

`src/composables/useAiwbDownload.ts`:

```ts
/** Aiwb 产物下载编排：加速 URL 拼接、扩展名判定，以及「exe 运行 / zip 解压安装」的执行。 */
import { invoke } from '@tauri-apps/api/core'
import { useTaskStore } from '@/stores/task'
import { usePreferenceStore } from '@/stores/preference'
import { silentInstall, decompressArchive } from '@/api/installer'

const GITHUB_HOST = 'github.com'

export function buildAcceleratedUrl(url: string, prefix: string): string {
  if (!url.startsWith(`https://${GITHUB_HOST}`) && !url.startsWith(`http://${GITHUB_HOST}`)) return url
  return `${prefix}${url}`
}

export function assetExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

const EXECUTABLE_EXT = new Set(['exe', 'msi', 'bat', 'cmd'])
const ARCHIVE_EXT = new Set(['zip', '7z', 'rar', 'tar', 'gz'])

export function isExecutableExt(ext: string): boolean { return EXECUTABLE_EXT.has(ext) }
export function isArchiveExt(ext: string): boolean { return ARCHIVE_EXT.has(ext) }

export function useAiwbDownload() {
  const taskStore = useTaskStore()
  const preferenceStore = usePreferenceStore()

  function basePath(): string {
    return (preferenceStore.config.dir || '').replace(/[\\/]+$/, '')
  }

  /** 计算下载路径（下载目录 + aiwbDownloadDir） */
  function downloadDir(): string {
    const base = basePath()
    return base ? `${base}/${preferenceStore.config.aiwbDownloadDir || 'aiwb'}` : ''
  }

  function installDir(): string {
    const base = basePath()
    return base ? `${base}/${preferenceStore.config.aiwbInstallDir || 'aiwb/install'}` : ''
  }

  async function addDownload(url: string, filename: string, split: number) {
    if (!downloadDir()) throw new Error('未配置下载目录')
    return taskStore.addUri({
      uris: [url],
      outs: [filename],
      options: { dir: downloadDir(), split: String(split ?? 64) },
    })
  }

  /** 运行指定 exe/文件 */
  async function runExecutable(filePath: string) {
    return invoke('open_path_normalized', { path: filePath })
  }

  async function installArchive(archivePath: string, targetDir = installDir()) {
    const decomp = await decompressArchive(archivePath, targetDir)
    return decomp
  }

  async function silentExecutable(filePath: string) {
    return silentInstall(filePath)
  }

  return { downloadDir, installDir, addDownload, runExecutable, installArchive, silentExecutable }
}
```

* [ ] **Step 4: 运行测试，确认通过**

Run（项目根）: `pnpm exec vitest run src/composables/__tests__/useAiwbDownload.test.ts`
Expected: PASS（5 条纯函数用例）。

* [ ] **Step 5: 提交**

```bash
git add src/composables/useAiwbDownload.ts src/composables/__tests__/useAiwbDownload.test.ts
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: useAiwbDownload 产物下载编排"
```

***

### Task 7: 前端页面 AiwbProjects.vue + 路由 + 侧栏入口

**Files:**

* Create: `src/views/AiwbProjects.vue`

* Modify: `src/router/index.ts`

* Modify: `src/components/layout/AsideBar.vue`

* [ ] **Step 1: 路由**

在 `src/router/index.ts` 的 `children` 中 `software` 路由后加入：

```ts
{
  path: '/aiwb',
  name: 'aiwb',
  component: () => import('@/views/AiwbProjects.vue'),
},
```

* [ ] **Step 2: 侧栏图标**

`src/components/layout/AsideBar.vue`：在 `script` 的 `@vicons/ionicons5` 导入中增加一个图标（如 `CubeOutline`），并在 `.top-menu` 的第一个 `<li>`（软件中心）之后、`task` 之前新增一个按钮导航到 `/aiwb`，`aria-label` 与 tooltip 文案用 `t('app.aiwb')`（并在语言包里补充该 key，`en-US`/`zh-CN` 的 `app.js`）。

```vue
<li>
  <MTooltip placement="right">
    <template #trigger>
      <button type="button" class="menu-button non-draggable" :aria-label="t('app.aiwb')" @click="nav('/aiwb')">
        <NIcon :size="20"><CubeOutline /></NIcon>
      </button>
    </template>
    {{ t('app.aiwb') }}
  </MTooltip>
</li>
```

* [ ] **Step 3: 实现页面**

`src/views/AiwbProjects.vue`（完整页面，本节给出结构骨架与关键逻辑；样式沿用软件中心/现有组件的 Material 变量）：

```vue
<script setup lang="ts">
/** @fileoverview Aiwb项目页：清单 + 按需拉取 GitHub Releases + 产物下载/安装。 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { NInput, NButton, NTag, NEmpty, NSpin, NSelect, NModal, useMessage } from 'naive-ui'
import { useAiwbCatalog, type AiwbEntry } from '@/composables/useAiwbCatalog'
import { useGitHubReleases, type GitHubRelease, type GitHubAsset } from '@/composables/useGitHubReleases'
import { useDownloadSource, DOWNLOAD_SOURCES } from '@/composables/useDownloadSource'
import { useAiwbDownload, buildAcceleratedUrl, isExecutableExt, assetExtension } from '@/composables/useAiwbDownload'
import { usePreferenceStore } from '@/stores/preference'
import { listen } from '@tauri-apps/api/event'

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
const sourceOptions = DOWNLOAD_SOURCES.map((s) => ({ label: s.name, value: s.key, speed: s.key }))
const sourceSpeeds = ref<Record<string, number | null>>({})
const probing = ref(false)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return all.value
  return all.value.filter((e) => e.name.toLowerCase().includes(q) || e.repo.toLowerCase().includes(q))
})

function extOf(name: string) { return assetExtension(name) }
function extTagType(ext: string) { return isExecutableExt(ext) ? 'success' : ext === 'zip' ? 'warning' : 'info' }

async function openEntry(entry: AiwbEntry) {
  activeEntry.value = entry
  releases.value = []
  releaseError.value = null
  loading.value = true
  const res = await fetchReleases(entry.repo, { proxy: preferenceStore.config.proxy?.server ?? null })
  loading.value = false
  if (res.error) releaseError.value = res.error
  else releases.value = res.data
}

function openArtifacts(rel: GitHubRelease) {
  selectedRelease.value = rel
  showArtifacts.value = true
  void refreshSpeeds()
}

async function refreshSpeeds() {
  probing.value = true
  for (const s of DOWNLOAD_SOURCES) {
    const url = `${s.prefix}/Ping`
    const ms = await probeSource(url, { proxy: preferenceStore.config.proxy?.server ?? null })
    sourceSpeeds.value[s.key] = ms
  }
  probing.value = false
}

function artifactUrl(asset: GitHubAsset): string {
  const prefix = DOWNLOAD_SOURCES.find((s) => s.key === currentSource())?.prefix ?? ''
  return buildAcceleratedUrl(asset.browserDownloadUrl, prefix)
}

async function downloadAsset(entry: AiwbEntry, rel: GitHubRelease, asset: GitHubAsset) {
  const url = artifactUrl(asset)
  try {
    await aiwb.addDownload(url, asset.name, preferenceStore.config.split ?? 64)
    message.success(`${entry.name}: 已添加下载任务`)
    showArtifacts.value = false
  } catch (e) {
    message.error(`${entry.name}: 添加下载任务失败`)
  }
}

async function handleAddRepo() {
  const repo = addRepoInput.value.trim()
  if (!isOwnerRepo(repo)) { message.warning('格式应为 owner/repo'); return }
  const ok = addRepo(repo)
  if (!ok) { message.warning('该仓库已存在或格式有误'); return }
  addRepoInput.value = ''
  message.success('已添加仓库')
}

function releaseChannel(rel: GitHubRelease) {
  if (!rel.prerelease) return { label: '正式版', type: 'success' as const }
  const s = `${rel.tagName} ${rel.name}`.toLowerCase()
  if (/(beta|rc|preview|alpha)/.test(s)) return { label: '测试版', type: 'warning' as const }
  return { label: '测试版', type: 'warning' as const }
}

// 下载完成 → 触发运行/安装（监听全局 complete 事件，用 pendingActions 关联 gid）
</script>
```

> 由于页面较长且含模板/样式，**本任务采用内联实现**：Task 7 的 Step 3 由执行者直接手写完整 `.vue`（脚本 + 模板 + 样式），遵循上述数据流与组件结构。要点：
>
> * 模板结构：顶部搜索框 + 「添加仓库」输入/按钮；中部为过滤后的卡片网格（分类可省略，先单列表）；点击卡片 → 展开该项目详情（版本左右布局 + 悬浮下载按钮 + 产物弹窗）。
>
> * 悬浮下载按钮：当有选中 `release` 时固定悬浮，点击 `openArtifacts`。
>
> * 产物弹窗：顶部 `NSelect`（下载源，选项 label 显示 `源名 · xxms`，speed 取自 `sourceSpeeds`，可点「重新测速」）；主体资产列表每行文件名 + 大小 + `NTag`（后缀）。
>
> * 「下载完成后 exe 运行 / zip 解压安装」：在 `onMounted` 里 `listen('task-monitor:complete', ...)`，用 gid 关联页面维护的 `pendingActions` Map（asset名→{action:'run'|'install'}），完成后用 `resolveTaskFilePath` 拿路径，执行 `runExecutable` 或 `installArchive`。`onBeforeUnmount` 时注销监听与清理 Map。若实现时该事件名与现有 MainLayout 用法不一致，以现有 `src/layouts/MainLayout.vue` 中 `task-monitor:complete` 的实际 payload 与 `resolveTaskFilePath` 用法为准。

* [ ] **Step 4: 补充语言 key**

在 `src/shared/locales/zh-CN/app.js` 与 `en-US/app.js` 增加：

```js
aiwb: 'Aiwb项目',
```

（`preferences.js` 中若使用新增的 `preferences.aiwb-download-dir` / `preferences.aiwb-install-dir`，需在 zh-CN/en-US 两处对应补充文案。）

* [ ] **Step 5: 前端构建验证**

Run（项目根）: `pnpm build`
Expected: 构建成功；若有类型错误（如 `@shared/aiwb-catalog.json` 无声明、事件 payload 类型不符、`NSelect` 选项类型），补齐 `src/types` 声明或调整类型后重跑直至通过。

* [ ] **Step 6: 运行全量测试**

Run（项目根）: `pnpm test`
Expected: 全量通过（既有测试不应因新增字段/路由/侧栏而变化；若失败，修正对应实现）。

* [ ] **Step 7: 提交**

```bash
git add src/views/AiwbProjects.vue src/router/index.ts src/components/layout/AsideBar.vue src/shared/locales/zh-CN/app.js src/shared/locales/en-US/app.js src/shared/locales/zh-CN/preferences.js src/shared/locales/en-US/preferences.js src/types/
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "feat: 新增 Aiwb项目页面（清单/Releases/产物下载安装）"
```

***

### Task 8: 后端+前端联调自查

**Files:**

* Modify: 无（仅验证）

* [ ] **Step 1: 后端检查与测试**

Run（在 `src-tauri`）: `cargo check && cargo test`
Expected: 无警告、测试全绿。

* [ ] **Step 2: 前端构建与测试**

Run（项目根）: `pnpm build && pnpm test`
Expected: 构建成功、测试全绿。

* [ ] **Step 3: 自查逻辑完整性**

* `fetch_github_releases` 的 repo 参数由 `AiwbEntry.repo`（`owner/name`）提供，`split_repo` 正确拆分。

* 产物弹窗下载源选项的「速度」展示源为 `sourceSpeeds`，`probeSource` 失败返回 `null`（显示 `不可用`）。

* 加速 URL 拼接复用 `DOWNLOAD_SOURCES` 的 prefix；`buildAcceleratedUrl` 对非 github 直链原样返回。

* 设置两项路径默认值在 `DEFAULT_APP_CONFIG` 提供，`useAiwbDownload` 的 `downloadDir/installDir` 以其为基础拼接。

* 下载完成后运行/安装依赖 `task-monitor:complete`，与 MainLayout 现有机制一致（含 `resolveTaskFilePath` 取本地路径）。

* [ ] **Step 4: 补充提交（若有遗留）**

```bash
git add -A
git -c user.name=ywydog -c user.email=ywydog@users.noreply.github.com commit -m "test: Aiwb 联调自查通过"
```

***

## Self-Review

**Spec coverage：**
- 内置 JSON 60 个软件（白板 10 + 课表 22 + 工具 28；TimerIn 无 GitHub 仓库故排除）→ Task 2

* 按需拉取 GitHub Releases（版本/日志/产物）→ Task 3 + Task 7

* 下载源切换并记住选择 → 复用 `useDownloadSource`（现有），Artifact 弹窗下拉 → Task 7

* 下载源链接速度（HEAD 探测）→ Task 1（probe\_http\_head）+ Task 3（probeSource）+ Task 7

* 版本号旁正式版/测试版徽标 → Task 7（releaseChannel）

* 版本左右布局、悬浮下载按钮、产物弹窗带尾缀 → Task 7

* 用户添加仓库本地持久化 → Task 4（localStorage）

* exe 下载后直接运行 / zip 解压后静默安装 → Task 6 + Task 7

* 下载路径 ≠ 静默安装路径、设置可调 → Task 5 + Task 6

* 限流/错误/测试 → Task 3/4/6 单测 + Task 8 联调

**Placeholder scan：** 无 TODO/TBD；Task 7 的 Step 3 为「内联手写页面」——这是刻意设计的执行方式，给出了完整数据流与组件要点，要求执行者一次性写出完整 `.vue`，不属于 "未提供内容" 的占位。

**Type consistency：**

* `GitHubRelease`/`GitHubAsset` 字段名（camelCase）在 Rust（`#[serde(rename_all = "camelCase")]`）与 TS 端一致。

* `useAiwbCatalog` 导出 `builtinRepos`、`isOwnerRepo`、`addRepo` 签名与测试一致。

* `useAiwbDownload` 的纯函数与测试一致。

* 命令名 `fetch_github_releases`/`probe_http_head` 在 Rust 与 `invoke` 调用一致。

