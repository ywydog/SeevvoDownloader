//! 希沃软件安装命令：静默安装、7z 解压、进程等待。
//! 静默安装（/S）与进程控制为 Windows 专用能力；
//! zip 解压跨平台可用（复用项目已依赖的 zip crate）。

use crate::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// 安装结果
#[derive(Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// 静默安装可执行安装包（Windows）。
///
/// 使用 `/S` 参数调用安装包完成静默安装，并等待进程结束。
/// 该命令需以管理员权限运行（由前端在调用前通过 UAC 提权）。
#[tauri::command]
pub async fn silent_install_software(app: AppHandle, installer_path: String) -> Result<InstallResult, AppError> {
    let _ = &app;
    let path = PathBuf::from(&installer_path);
    if !path.exists() {
        return Ok(InstallResult {
            success: false,
            message: format!("安装包不存在: {installer_path}"),
        });
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        log::info!("installer:silent-install path={installer_path}");
        let output = Command::new(&path)
            .arg("/S")
            .output()
            .map_err(|e| AppError::Io(format!("静默安装启动失败: {e}")))?;

        if output.status.success() {
            Ok(InstallResult {
                success: true,
                message: "静默安装完成".to_string(),
            })
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            log::error!("installer:silent-install-failed status={} stderr={stderr}", output.status);
            Ok(InstallResult {
                success: false,
                message: format!("静默安装失败 (退出码 {})", output.status),
            })
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(InstallResult {
            success: false,
            message: "静默安装仅在 Windows 平台可用".to_string(),
        })
    }
}

/// 解压压缩包到目标目录。
///
/// 支持 .zip（跨平台，使用 zip crate）；.7z 在 Windows 上优先调用 7z.exe，
/// 否则尝试使用内置的 sevenz 解压（若编译特性可用则回退报错）。
#[tauri::command]
pub async fn decompress_archive(
    app: AppHandle,
    archive_path: String,
    output_dir: String,
) -> Result<InstallResult, AppError> {
    let _ = &app;
    let archive = PathBuf::from(&archive_path);
    let out = PathBuf::from(&output_dir);
    if !archive.exists() {
        return Ok(InstallResult {
            success: false,
            message: format!("压缩包不存在: {archive_path}"),
        });
    }
    std::fs::create_dir_all(&out).map_err(|e| AppError::Io(format!("创建输出目录失败: {e}")))?;

    let ext = archive
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "zip" => extract_zip(&archive, &out),
        "7z" => extract_7z(&archive, &out),
        other => Ok(InstallResult {
            success: false,
            message: format!("暂不支持的解压格式: {other}"),
        }),
    }
}

fn extract_zip(archive: &Path, out: &Path) -> Result<InstallResult, AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::Io(format!("打开压缩包失败: {e}")))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Io(format!("读取 zip 失败: {e}")))?;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::Io(format!("读取 zip 条目失败: {e}")))?;
        let entry_path = match entry.enclosed_name() {
            Some(p) => p.to_owned(),
            None => continue,
        };
        let target = out.join(entry_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|e| AppError::Io(format!("创建目录失败: {e}")))?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Io(format!("创建目录失败: {e}")))?;
            }
            let mut out_file = std::fs::File::create(&target)
                .map_err(|e| AppError::Io(format!("创建文件失败: {e}")))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| AppError::Io(format!("解压写入失败: {e}")))?;
        }
    }

    Ok(InstallResult {
        success: true,
        message: format!("解压完成: {} → {}", path_str(archive), path_str(out)),
    })
}

fn extract_7z(archive: &Path, out: &Path) -> Result<InstallResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        // 优先使用随包的 7z.exe
        let base_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let seven_zip_path = base_dir.join("Tools").join("7z.exe");
        if seven_zip_path.exists() {
            let output = std::process::Command::new(&seven_zip_path)
                .arg("x")
                .arg("-y")
                .arg("-o")
                .arg(path_str(out))
                .arg(path_str(archive))
                .output()
                .map_err(|e| AppError::Io(format!("7z 解压启动失败: {e}")))?;
            if output.status.success() {
                return Ok(InstallResult {
                    success: true,
                    message: "7z 解压完成".to_string(),
                });
            }
        }
        Ok(InstallResult {
            success: false,
            message: "7z 解压失败：未找到 7z.exe 或解压异常".to_string(),
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (archive, out);
        Ok(InstallResult {
            success: false,
            message: "7z 解压仅在 Windows 平台可用".to_string(),
        })
    }
}

/// 终止指定进程（Windows，taskkill）。
#[tauri::command]
pub async fn kill_process_by_name(app: AppHandle, process_name: String) -> Result<InstallResult, AppError> {
    let _ = &app;
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("taskkill")
            .args(["/f", "/im", &process_name])
            .output()
            .map_err(|e| AppError::Io(format!("taskkill 调用失败: {e}")))?;
        if output.status.success() {
            Ok(InstallResult {
                success: true,
                message: format!("已终止进程 {process_name}"),
            })
        } else {
            Ok(InstallResult {
                success: false,
                message: format!("进程 {process_name} 未找到或无法终止"),
            })
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = &process_name;
        Ok(InstallResult {
            success: false,
            message: "进程管理仅在 Windows 平台可用".to_string(),
        })
    }
}
