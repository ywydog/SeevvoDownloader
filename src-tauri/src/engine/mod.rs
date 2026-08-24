//! Engine management for the bundled SeevvoDownloader engine sidecar.
//!
//! Split into focused sub-modules:
//! - [`state`] — `EngineState` struct, ANSI stripping, log routing
//! - [`lifecycle`] — `start_engine`, `stop_engine`, `restart_engine`
//! - [`config`] — managed runtime configuration for Aria2 Next
//! - [`cleanup`] — Port cleanup and process identification

mod cleanup;
mod config;
mod lifecycle;
mod log_level;
mod state;

pub(crate) use config::{non_hot_reloadable_keys, runtime_config_path, supported_engine_keys};
pub use lifecycle::{restart_engine, start_engine, stop_engine};
pub(crate) use log_level::{valid_aria2_log_level, DEFAULT_ARIA2_LOG_LEVEL};
pub(crate) use state::path_to_safe_string;
pub use state::EngineState;
