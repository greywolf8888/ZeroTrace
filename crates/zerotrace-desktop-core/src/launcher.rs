//! Workspace-linked workstation launcher.
//!
//! The executable is a pointer, not a frozen app image. Ports, spawn command and
//! workspace root are read from the live checkout on every start so web/API
//! changes do not require regenerating the EXE.

use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

pub const DEV_LINK_REL: &str = "apps/desktop/dev-link.json";
pub const SIDECAR_FILE_NAME: &str = "ZeroTrace.workspace.json";
pub const WORKSPACE_POINTER_SCHEMA: &str = "zerotrace-desktop-workspace-pointer-v1";
pub const DEV_LINK_SCHEMA: &str = "zerotrace-desktop-dev-link-v1";
pub const WORKSPACE_PACKAGE_NAME: &str = "zerotrace";

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum LauncherError {
    #[error("未找到 ZeroTrace 工作区（需要根 package.json 与 {DEV_LINK_REL}）")]
    WorkspaceNotFound,
    #[error("ZEROTRACE_ROOT 不是有效工作区: {0}")]
    InvalidEnvRoot(String),
    #[error("工作区指针无效: {0}")]
    InvalidPointer(String),
    #[error("开发联动配置无效: {0}")]
    InvalidDevLink(String),
    #[error("启动器拒绝非只读配置")]
    NotReadOnly,
    #[error("开发服务状态冲突: {0}")]
    ServiceConflict(String),
    #[error("缺少 node_modules，请先在工作区执行 npm ci")]
    MissingNodeModules,
    #[error("无法解析监听地址 {host}:{port}")]
    BadEndpoint { host: String, port: u16 },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePointer {
    pub schema_version: String,
    pub workspace_root: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    #[serde(default = "default_path")]
    pub path: String,
}

fn default_path() -> String {
    "/".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DevLink {
    pub schema_version: String,
    pub read_only: bool,
    pub web: Endpoint,
    pub api: Endpoint,
    pub spawn: SpawnSpec,
    #[serde(default = "default_wait_timeout_ms")]
    pub wait_timeout_ms: u64,
    #[serde(default = "default_poll_interval_ms")]
    pub poll_interval_ms: u64,
}

fn default_wait_timeout_ms() -> u64 {
    180_000
}

fn default_poll_interval_ms() -> u64 {
    500
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LaunchAction {
    AttachExisting,
    SpawnDev,
}

#[derive(Clone, Debug)]
pub struct LaunchPlan {
    pub workspace_root: PathBuf,
    pub web_url: String,
    pub action: LaunchAction,
    pub link: DevLink,
}

#[derive(Clone, Debug, Default)]
pub struct ResolveInputs<'a> {
    pub env_root: Option<&'a Path>,
    pub pointer: Option<&'a WorkspacePointer>,
    pub exe_dir: Option<&'a Path>,
    pub cwd: Option<&'a Path>,
}

pub fn strip_json_bom(text: &str) -> &str {
    text.trim_start_matches('\u{feff}').trim_start()
}

pub fn parse_workspace_pointer(json: &str) -> Result<WorkspacePointer, LauncherError> {
    let pointer: WorkspacePointer = serde_json::from_str(strip_json_bom(json))
        .map_err(|err| LauncherError::InvalidPointer(err.to_string()))?;
    if pointer.schema_version != WORKSPACE_POINTER_SCHEMA {
        return Err(LauncherError::InvalidPointer(format!(
            "schemaVersion={}",
            pointer.schema_version
        )));
    }
    if pointer.workspace_root.trim().is_empty() {
        return Err(LauncherError::InvalidPointer(
            "workspaceRoot is empty".into(),
        ));
    }
    Ok(pointer)
}

pub fn parse_dev_link(json: &str) -> Result<DevLink, LauncherError> {
    let link: DevLink = serde_json::from_str(strip_json_bom(json))
        .map_err(|err| LauncherError::InvalidDevLink(err.to_string()))?;
    if link.schema_version != DEV_LINK_SCHEMA {
        return Err(LauncherError::InvalidDevLink(format!(
            "schemaVersion={}",
            link.schema_version
        )));
    }
    if !link.read_only {
        return Err(LauncherError::NotReadOnly);
    }
    if link.spawn.program.trim().is_empty() {
        return Err(LauncherError::InvalidDevLink(
            "spawn.program is empty".into(),
        ));
    }
    if link.web.port == 0 || link.api.port == 0 {
        return Err(LauncherError::InvalidDevLink("port must be > 0".into()));
    }
    Ok(link)
}

pub fn looks_like_workspace(root: &Path) -> bool {
    let package = root.join("package.json");
    let Ok(text) = fs::read_to_string(&package) else {
        return false;
    };
    if !package_name_is_zerotrace(&text) {
        return false;
    }
    root.join("apps/web").is_dir()
        && root.join("apps/api").is_dir()
        && root.join(DEV_LINK_REL).is_file()
}

fn package_name_is_zerotrace(package_json: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(strip_json_bom(package_json)) else {
        return false;
    };
    value.get("name").and_then(|name| name.as_str()) == Some(WORKSPACE_PACKAGE_NAME)
}

pub fn walk_to_workspace(start: &Path, max_levels: usize) -> Option<PathBuf> {
    let mut current = Some(start);
    for _ in 0..=max_levels {
        let path = current?;
        if looks_like_workspace(path) {
            return Some(path.to_path_buf());
        }
        current = path.parent();
    }
    None
}

pub fn resolve_workspace(inputs: ResolveInputs<'_>) -> Result<PathBuf, LauncherError> {
    if let Some(root) = inputs.env_root {
        if looks_like_workspace(root) {
            return Ok(root.to_path_buf());
        }
        return Err(LauncherError::InvalidEnvRoot(root.display().to_string()));
    }
    if let Some(pointer) = inputs.pointer {
        let root = PathBuf::from(&pointer.workspace_root);
        if looks_like_workspace(&root) {
            return Ok(root);
        }
        return Err(LauncherError::InvalidPointer(root.display().to_string()));
    }
    if let Some(exe_dir) = inputs.exe_dir {
        if let Some(root) = walk_to_workspace(exe_dir, 12) {
            return Ok(root);
        }
    }
    if let Some(cwd) = inputs.cwd {
        if let Some(root) = walk_to_workspace(cwd, 12) {
            return Ok(root);
        }
    }
    Err(LauncherError::WorkspaceNotFound)
}

pub fn load_dev_link(root: &Path) -> Result<DevLink, LauncherError> {
    let path = root.join(DEV_LINK_REL);
    let text = fs::read_to_string(&path)
        .map_err(|err| LauncherError::InvalidDevLink(format!("{}: {err}", path.display())))?;
    parse_dev_link(&text)
}

pub fn endpoint_url(endpoint: &Endpoint) -> String {
    let path = if endpoint.path.starts_with('/') {
        endpoint.path.clone()
    } else {
        format!("/{}", endpoint.path)
    };
    if path == "/" {
        format!("http://{}:{}", endpoint.host, endpoint.port)
    } else {
        format!("http://{}:{}{}", endpoint.host, endpoint.port, path)
    }
}

pub fn endpoint_addr(endpoint: &Endpoint) -> Result<SocketAddr, LauncherError> {
    let spec = format!("{}:{}", endpoint.host, endpoint.port);
    spec.to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .ok_or_else(|| LauncherError::BadEndpoint {
            host: endpoint.host.clone(),
            port: endpoint.port,
        })
}

pub fn tcp_open(endpoint: &Endpoint, timeout: Duration) -> bool {
    let Ok(addr) = endpoint_addr(endpoint) else {
        return false;
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

pub fn decide_action(web_up: bool, api_up: bool) -> Result<LaunchAction, LauncherError> {
    match (web_up, api_up) {
        (true, true) => Ok(LaunchAction::AttachExisting),
        (false, false) => Ok(LaunchAction::SpawnDev),
        (true, false) => Err(LauncherError::ServiceConflict(
            "Web 已在监听但 API 未就绪。请检查现有 npm run dev 窗口，勿重复启动。".into(),
        )),
        (false, true) => Err(LauncherError::ServiceConflict(
            "API 已在监听但 Web 未就绪。请检查现有 npm run dev 窗口，勿重复启动。".into(),
        )),
    }
}

pub fn require_node_modules(root: &Path) -> Result<(), LauncherError> {
    if root.join("node_modules").is_dir() {
        Ok(())
    } else {
        Err(LauncherError::MissingNodeModules)
    }
}

pub fn plan_launch(root: PathBuf, web_up: bool, api_up: bool) -> Result<LaunchPlan, LauncherError> {
    let link = load_dev_link(&root)?;
    let action = decide_action(web_up, api_up)?;
    if action == LaunchAction::SpawnDev {
        require_node_modules(&root)?;
    }
    Ok(LaunchPlan {
        web_url: endpoint_url(&link.web),
        workspace_root: root,
        action,
        link,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("zt-launcher-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_workspace(root: &Path) {
        fs::create_dir_all(root.join("apps/web")).unwrap();
        fs::create_dir_all(root.join("apps/api")).unwrap();
        fs::create_dir_all(root.join("apps/desktop")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"name":"zerotrace","private":true}"#,
        )
        .unwrap();
        let mut link = fs::File::create(root.join(DEV_LINK_REL)).unwrap();
        write!(
            link,
            r#"{{
  "schemaVersion": "zerotrace-desktop-dev-link-v1",
  "readOnly": true,
  "web": {{ "host": "127.0.0.1", "port": 5173 }},
  "api": {{ "host": "127.0.0.1", "port": 8080, "path": "/health" }},
  "spawn": {{ "program": "npm", "args": ["run", "dev"] }}
}}"#
        )
        .unwrap();
    }

    fn sample_dev_link(read_only: bool) -> String {
        format!(
            r#"{{
            "schemaVersion": "zerotrace-desktop-dev-link-v1",
            "readOnly": {read_only},
            "web": {{"host": "127.0.0.1", "port": 5173, "future": true}},
            "api": {{"host": "127.0.0.1", "port": 8080, "path": "/health"}},
            "spawn": {{"program": "npm", "args": ["run", "dev"]}},
            "newOptional": "ignored-by-old-exe"
        }}"#
        )
    }

    #[test]
    fn parses_workspace_pointer_with_utf8_bom() {
        let json = format!(
            "\u{feff}{}",
            r#"{"schemaVersion":"zerotrace-desktop-workspace-pointer-v1","workspaceRoot":"F:\\ZeroTrace"}"#
        );
        let pointer = parse_workspace_pointer(&json).expect("bom must not fail closed");
        assert_eq!(pointer.workspace_root, r"F:\ZeroTrace");
    }

    #[test]
    fn extra_json_fields_do_not_invalidate_dev_link() {
        let link = parse_dev_link(&sample_dev_link(true)).expect("forward compatible");
        assert_eq!(link.web.port, 5173);
        assert_eq!(link.wait_timeout_ms, 180_000);
    }

    #[test]
    fn rejects_writable_dev_link() {
        assert_eq!(
            parse_dev_link(&sample_dev_link(false)),
            Err(LauncherError::NotReadOnly)
        );
    }

    #[test]
    fn attach_when_both_ports_live_spawn_when_both_down() {
        assert_eq!(
            decide_action(true, true).unwrap(),
            LaunchAction::AttachExisting
        );
        assert_eq!(decide_action(false, false).unwrap(), LaunchAction::SpawnDev);
        assert!(matches!(
            decide_action(true, false),
            Err(LauncherError::ServiceConflict(_))
        ));
    }

    #[test]
    fn env_root_wins_and_fails_closed_when_invalid() {
        let root = temp_dir();
        write_workspace(&root);
        let resolved = resolve_workspace(ResolveInputs {
            env_root: Some(&root),
            ..ResolveInputs::default()
        })
        .unwrap();
        assert_eq!(resolved, root);

        let missing = root.join("nope");
        let err = resolve_workspace(ResolveInputs {
            env_root: Some(&missing),
            cwd: Some(&root),
            ..ResolveInputs::default()
        })
        .unwrap_err();
        assert!(matches!(err, LauncherError::InvalidEnvRoot(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn walks_from_bin_dir_and_pointer() {
        let root = temp_dir();
        write_workspace(&root);
        let bin = root.join("apps/desktop/bin");
        fs::create_dir_all(&bin).unwrap();
        let walked = resolve_workspace(ResolveInputs {
            exe_dir: Some(&bin),
            ..ResolveInputs::default()
        })
        .unwrap();
        assert_eq!(walked, root);

        let pointer = WorkspacePointer {
            schema_version: WORKSPACE_POINTER_SCHEMA.into(),
            workspace_root: root.to_string_lossy().into_owned(),
        };
        let pointed = resolve_workspace(ResolveInputs {
            pointer: Some(&pointer),
            ..ResolveInputs::default()
        })
        .unwrap();
        assert_eq!(pointed, root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn spawn_plan_requires_node_modules() {
        let root = temp_dir();
        write_workspace(&root);
        let err = plan_launch(root.clone(), false, false).unwrap_err();
        assert_eq!(err, LauncherError::MissingNodeModules);
        fs::create_dir_all(root.join("node_modules")).unwrap();
        let plan = plan_launch(root.clone(), false, false).unwrap();
        assert_eq!(plan.action, LaunchAction::SpawnDev);
        assert_eq!(plan.web_url, "http://127.0.0.1:5173");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn endpoint_url_omits_trailing_slash_on_root() {
        let web = Endpoint {
            host: "127.0.0.1".into(),
            port: 5173,
            path: "/".into(),
        };
        assert_eq!(endpoint_url(&web), "http://127.0.0.1:5173");
        let api = Endpoint {
            host: "127.0.0.1".into(),
            port: 8080,
            path: "/health".into(),
        };
        assert_eq!(endpoint_url(&api), "http://127.0.0.1:8080/health");
    }
}
