use std::sync::atomic::Ordering;
use tauri::async_runtime::Receiver;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use super::cleanup::cleanup_port;
use super::config::{generate_runtime_config, runtime_config_args, ManagedEngineConfig};
use super::state::{path_to_safe_string, strip_ansi, EngineState};
use super::{valid_aria2_log_level, DEFAULT_ARIA2_LOG_LEVEL};
use crate::services::port_guard;
use tauri_plugin_store::StoreExt;

static BT_PORT_RECOVERY_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

const ENGINE_SIDECAR_NAME: &str = "motrix-next-engine";
const DEFAULT_RPC_PORT_STR: &str = "29100";
const ENGINE_PORT_RELEASE_TIMEOUT_MS: u64 = 2600;
const ENGINE_PORT_RELEASE_POLL_MS: u64 = 100;
const PROXY_ENV_VARS: &[&str] = &[
    "http_proxy",
    "https_proxy",
    "ftp_proxy",
    "all_proxy",
    "no_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "FTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
];

fn sanitized_engine_proxy_env() -> Vec<(&'static str, &'static str)> {
    PROXY_ENV_VARS.iter().map(|key| (*key, "")).collect()
}

fn read_aria2_log_level(app: &tauri::AppHandle) -> String {
    let Some(store) = app.store("config.json").ok() else {
        return DEFAULT_ARIA2_LOG_LEVEL.to_string();
    };
    let Some(level) = store
        .get("preferences")
        .and_then(|p| p.get("aria2LogLevel")?.as_str().map(ToString::to_string))
    else {
        return DEFAULT_ARIA2_LOG_LEVEL.to_string();
    };
    if valid_aria2_log_level(&level) {
        level
    } else {
        DEFAULT_ARIA2_LOG_LEVEL.to_string()
    }
}

fn engine_log_config(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get app log dir: {e}"))?
        .join(crate::log_policy::ARIA2_LOG_FILE);
    let log_path = path_to_safe_string(&log_path);
    let log_level = read_aria2_log_level(app);
    Ok((log_path, log_level))
}

fn recover_runtime_port_conflict(app: &tauri::AppHandle, kind: port_guard::PortKind) {
    if BT_PORT_RECOVERY_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let recovery = match port_guard::reconcile_runtime_ports(&app_handle, &[kind]) {
            Ok(switches) if !switches.is_empty() => {
                log::warn!("port_guard: recovering runtime bind failure switches={switches:?}");
                let app_for_restart = app_handle.clone();
                match tokio::task::spawn_blocking(move || {
                    restart_engine(&app_for_restart).map_err(crate::error::AppError::Engine)
                })
                .await
                {
                    Ok(Ok(())) => {
                        let _ = app_handle.emit(
                            "engine-recovered",
                            serde_json::json!({ "source": "bt-port-auto-switch" }),
                        );
                        Ok(())
                    }
                    Ok(Err(e)) => {
                        log::error!("port_guard: runtime bind recovery restart failed: {e}");
                        Err(())
                    }
                    Err(e) => {
                        log::error!("port_guard: runtime bind recovery task failed: {e}");
                        Err(())
                    }
                }
            }
            Ok(_) => {
                log::warn!("port_guard: runtime bind failure detected but no port was switched");
                Err(())
            }
            Err(e) => {
                log::error!("port_guard: runtime bind recovery failed: {e}");
                Err(())
            }
        };
        let _ = recovery;
        BT_PORT_RECOVERY_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
}

fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let status = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("Failed to execute taskkill for PID {pid}: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("taskkill failed for PID {pid}: {status}"));
    }

    #[cfg(not(windows))]
    {
        let status = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|e| format!("Failed to execute kill for PID {pid}: {e}"))?;
        if status.success() {
            return Ok(());
        }
        Err(format!("kill failed for PID {pid}: {status}"))
    }
}

fn wait_for_engine_ports_release(app: &tauri::AppHandle) {
    match port_guard::wait_for_engine_ports_available(
        app,
        std::time::Duration::from_millis(ENGINE_PORT_RELEASE_TIMEOUT_MS),
        std::time::Duration::from_millis(ENGINE_PORT_RELEASE_POLL_MS),
    ) {
        Ok(true) => {}
        Ok(false) => {
            log::warn!(
                "restart: engine ports still occupied after {}ms, running conflict recovery",
                ENGINE_PORT_RELEASE_TIMEOUT_MS
            );
        }
        Err(e) => {
            log::warn!("restart: failed to wait for engine port release: {e}");
        }
    }
}

fn prepare_engine_args(
    app: &tauri::AppHandle,
    config: &serde_json::Value,
) -> Result<Vec<String>, String> {
    if let Some(directory) = config.get("dir").and_then(serde_json::Value::as_str) {
        std::fs::create_dir_all(directory).map_err(|error| {
            format!("Failed to create download directory '{directory}': {error}")
        })?;
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data dir: {error}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    let session_path = data_dir.join("download.session");
    let session_path_string = path_to_safe_string(&session_path);

    let (log_file_path, log_level) = engine_log_config(app)?;
    let runtime_config = generate_runtime_config(
        app,
        config,
        ManagedEngineConfig {
            session_path: &session_path_string,
            load_session: session_path.exists(),
            log_file_path: &log_file_path,
            log_level: &log_level,
        },
    )?;
    Ok(runtime_config_args(&runtime_config))
}

fn spawn_engine(
    app: &tauri::AppHandle,
    args: &[String],
) -> Result<(Receiver<CommandEvent>, CommandChild), String> {
    log::info!("spawning engine process: argument_count={}", args.len());
    app.shell()
        .sidecar(ENGINE_SIDECAR_NAME)
        .map_err(|error| format!("Failed to create sidecar: {error}"))?
        .envs(sanitized_engine_proxy_env())
        .args(args)
        .spawn()
        .map_err(|error| format!("Failed to spawn Aria2 Next: {error}"))
}

fn monitor_engine(
    app: tauri::AppHandle,
    mut receiver: Receiver<CommandEvent>,
    process_id: u32,
    generation: u32,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = strip_ansi(&String::from_utf8_lossy(&line));
                    if let Some(kind) = port_guard::aria2_runtime_bind_error_kind(&text) {
                        recover_runtime_port_conflict(&app, kind);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        log::warn!("engine stderr: {trimmed}");
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let exit_code = payload.code.unwrap_or(-1);
                    log::warn!("engine terminated: exit_code={exit_code}");

                    let is_stale = app
                        .try_state::<EngineState>()
                        .is_none_or(|state| !state.is_current_generation(generation));
                    if is_stale {
                        log::debug!("stale monitor (generation={generation}) ignored termination");
                        break;
                    }

                    let was_intentional = app
                        .try_state::<EngineState>()
                        .is_some_and(|state| state.intentional_stop.swap(false, Ordering::SeqCst));
                    if was_intentional {
                        let _ = app.emit("engine-stopped", ());
                    } else {
                        let _ = app.emit(
                            "engine-crashed",
                            serde_json::json!({
                                "code": exit_code,
                                "signal": payload.signal
                            }),
                        );
                    }

                    if let Some(state) = app.try_state::<EngineState>() {
                        if let Ok(mut child) = state.child.lock() {
                            if child
                                .as_ref()
                                .map(tauri_plugin_shell::process::CommandChild::pid)
                                == Some(process_id)
                            {
                                *child = None;
                            }
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });
}

/// Spawns Aria2 Next from the current persisted system configuration.
pub fn start_engine(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<EngineState>();
    let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;

    if child_lock.is_some() {
        return Ok(());
    }

    if let Err(e) = port_guard::reconcile_engine_ports(app) {
        log::warn!("port_guard: startup reconciliation failed: {e}");
    }

    let config =
        crate::commands::config::get_system_config(app.clone()).map_err(|e| e.to_string())?;

    // Kill any leftover supported engine process on the RPC port before starting
    let port = config
        .get("rpc-listen-port")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_RPC_PORT_STR);
    cleanup_port(port);

    let args = prepare_engine_args(app, &config)?;
    let (receiver, child) = spawn_engine(app, &args)?;

    log::info!("started engine process: PID {}", child.pid());

    let spawned_pid = child.pid();
    *child_lock = Some(child);
    state.intentional_stop.store(false, Ordering::SeqCst);
    let my_gen = state.next_generation();
    monitor_engine(app.clone(), receiver, spawned_pid, my_gen);

    Ok(())
}

/// Stops the running engine process.
///
/// Two modes are available, selected by `for_exit`:
///
/// - **`for_exit = true`** (app shutdown): uses `CommandChild::kill()`
///   (`TerminateProcess` on Windows, `SIGKILL` on Unix).  Returns in < 1 ms
///   because the OS reclaims all child resources when the main process exits
///   moments later.  No sleep is needed — we will never reuse the port.
///
/// - **`for_exit = false`** (restart / command): uses `kill_process_by_pid()`
///   (`taskkill /T /F` on Windows, `kill -TERM` on Unix) to ensure the entire
///   process tree is dead, then sleeps 100 ms for the OS to release the RPC
///   port before a new engine instance binds to it.
///
/// Aria2 Next is a single-process, multi-threaded binary — it never spawns child
/// processes — so `CommandChild::kill()` and `taskkill /T` are functionally
/// equivalent for termination.  The distinction matters only for timing: the
/// fast path avoids the ~800 ms overhead of spawning `taskkill.exe` and the
/// subsequent 100 ms sleep, which is unnecessary during app exit.
pub fn stop_engine(app: &tauri::AppHandle, for_exit: bool) -> Result<(), String> {
    let state = app.state::<EngineState>();
    // Signal intentional stop BEFORE kill so the Terminated handler
    // knows this is deliberate and suppresses engine-error.
    state.intentional_stop.store(true, Ordering::SeqCst);
    let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;

    if for_exit {
        // Fast path: app is exiting — OS will reclaim all child resources.
        if let Some(child) = child_lock.take() {
            let pid = child.pid();
            let _ = child.kill(); // best-effort; ignore errors
            log::info!("stopped engine process: PID {} (fast exit)", pid);
        }
    } else {
        // Thorough path: must guarantee process tree is dead and port is free.
        if let Some(child) = child_lock.as_ref() {
            let pid = child.pid();
            kill_process_by_pid(pid)?;
            *child_lock = None;
            log::info!("stopped engine process: PID {}", pid);
            // Brief wait for the OS to fully terminate the process and release the port.
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    Ok(())
}

/// Atomically stops the current engine and starts a new one.
///
/// Holds the `EngineState` Mutex for the entire duration to prevent concurrent
/// restarts from spawning duplicate Aria2 Next processes.  Sequence:
///   1. Kill the old child (if any) and wait for OS cleanup
///   2. Run `cleanup_port` to kill any orphaned engine on the RPC port
///   3. Spawn a new Aria2 Next sidecar
///
/// This is the fix for: rapid "Save & Apply" → "Restart Engine" creating
/// orphaned engine processes on all platforms.
pub fn restart_engine(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<EngineState>();
    // Signal intentional stop BEFORE kill so the old process's Terminated
    // handler suppresses engine-error.
    state.intentional_stop.store(true, Ordering::SeqCst);
    let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;

    // Step 1: Kill existing child if present
    if let Some(child) = child_lock.as_ref() {
        let pid = child.pid();
        kill_process_by_pid(pid)?;
        *child_lock = None;
        log::info!("restart: killed old engine process: PID {}", pid);
        wait_for_engine_ports_release(app);
    }

    if let Err(e) = port_guard::reconcile_engine_ports(app) {
        log::warn!("port_guard: restart reconciliation failed: {e}");
    }

    let config =
        crate::commands::config::get_system_config(app.clone()).map_err(|e| e.to_string())?;

    // Step 2: Defense-in-depth — kill any orphans still holding the port
    let port = config
        .get("rpc-listen-port")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_RPC_PORT_STR);
    cleanup_port(port);

    // Step 3: Rebuild the runtime config and spawn a new engine.
    let args = prepare_engine_args(app, &config)?;
    let (receiver, child) = spawn_engine(app, &args)?;

    log::info!("restart: started new engine process: PID {}", child.pid());
    let spawned_pid = child.pid();
    *child_lock = Some(child);
    let my_gen = state.next_generation();

    // Reset intentional_stop for the NEW process.  This is safe because old
    // monitors are gated by generation and will never reach the swap — they
    // break immediately on stale gen check.  Without this reset, the flag
    // stays true forever and every future termination is wrongly treated as
    // intentional (suppressing crash detection AND blocking app exit).
    state.intentional_stop.store(false, Ordering::SeqCst);

    monitor_engine(app.clone(), receiver, spawned_pid, my_gen);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitized_engine_proxy_env_clears_lowercase_and_uppercase_proxy_vars() {
        let env = sanitized_engine_proxy_env();

        for key in PROXY_ENV_VARS {
            assert!(env
                .iter()
                .any(|(name, value)| name == key && value.is_empty()));
        }
    }
}
