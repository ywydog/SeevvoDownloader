use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
// GitHub API 返回 snake_case 字段，反序列化用 snake_case；
// 前端 (`useGitHubReleases`) 期望 camelCase，序列化用 camelCase。
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