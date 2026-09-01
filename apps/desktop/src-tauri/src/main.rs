//! ZeroTrace production desktop host.
//! Read-only invariants are preserved: no private keys, signing, broadcasting, or fund movement.

use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

struct ApiSidecar(Mutex<Option<CommandChild>>);

const PORTABLE_MARKER_FILE: &str = "zerotrace-portable.json";
const PORTABLE_SCHEMA_VERSION: &str = "zerotrace-portable-v1";
const PORTABLE_DATA_DIRECTORY: &str = "ZeroTrace-Data";
const PAPER_PORTFOLIO_CONFIG: &str = "config/paper_portfolios.json";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortableMarker {
    schema_version: String,
    read_only: bool,
}

struct RuntimeLayout {
    portable: bool,
    executable_directory: PathBuf,
    data_root: PathBuf,
    paper_portfolio_config: PathBuf,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationDispatchReceipt {
    transport: &'static str,
    dispatch_confirmation: &'static str,
    business_key: String,
}

fn validate_notification_text(
    value: &str,
    field: &str,
    maximum_chars: usize,
) -> Result<(), String> {
    let length = value.chars().count();
    if length == 0 || length > maximum_chars {
        return Err(format!("{field} 长度必须为 1 至 {maximum_chars} 个字符"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{field} 不能包含控制字符"));
    }
    Ok(())
}

fn show_system_notification(app: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {
    validate_notification_text(title, "提醒标题", 120)?;
    validate_notification_text(body, "提醒正文", 512)?;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("系统提醒接口拒绝投递：{error}"))
}

#[tauri::command]
fn dispatch_os_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    business_key: String,
) -> Result<NotificationDispatchReceipt, String> {
    validate_notification_text(&business_key, "提醒业务键", 512)?;
    show_system_notification(&app, &title, &body)?;
    Ok(NotificationDispatchReceipt {
        transport: "TAURI_NOTIFICATION_PLUGIN",
        dispatch_confirmation: "HANDED_TO_OS_API_NOT_USER_READ_CONFIRMATION",
        business_key,
    })
}

fn reserve_loopback_port() -> io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_loopback(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}")
                .parse()
                .expect("valid loopback address"),
            Duration::from_millis(150),
        )
        .is_ok()
        {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn invalid_portable_layout(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn resolve_runtime_layout(
    executable_directory: &Path,
    resource_directory: &Path,
    app_data_directory: &Path,
) -> io::Result<RuntimeLayout> {
    let marker_path = executable_directory.join(PORTABLE_MARKER_FILE);
    let portable = marker_path.is_file();
    if portable {
        let metadata = fs::metadata(&marker_path)?;
        if metadata.len() > 4_096 {
            return Err(invalid_portable_layout("便携版标记文件超过 4096 字节。"));
        }
        let marker: PortableMarker = serde_json::from_slice(&fs::read(&marker_path)?)
            .map_err(|error| invalid_portable_layout(format!("便携版标记无效：{error}")))?;
        if marker.schema_version != PORTABLE_SCHEMA_VERSION || !marker.read_only {
            return Err(invalid_portable_layout(
                "便携版标记必须使用 zerotrace-portable-v1 且明确 readOnly=true。",
            ));
        }
    }

    let paper_portfolio_config = if portable {
        executable_directory.join(PAPER_PORTFOLIO_CONFIG)
    } else {
        resource_directory.join(PAPER_PORTFOLIO_CONFIG)
    };
    if !paper_portfolio_config.is_file() {
        return Err(invalid_portable_layout(format!(
            "缺少版本化模拟资金配置：{}",
            paper_portfolio_config.display()
        )));
    }

    let data_root = if portable {
        executable_directory
            .join(PORTABLE_DATA_DIRECTORY)
            .join("storage-plane")
    } else {
        app_data_directory.join("storage-plane")
    };
    fs::create_dir_all(&data_root)?;
    Ok(RuntimeLayout {
        portable,
        executable_directory: executable_directory.to_path_buf(),
        data_root,
        paper_portfolio_config,
    })
}

fn authenticated_http_status(port: u16, path: &str, desktop_token: &str) -> io::Result<u16> {
    if !path.starts_with('/') || path.contains('\r') || path.contains('\n') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid HTTP path",
        ));
    }
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .expect("valid loopback address");
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-ZeroTrace-Desktop-Token: {desktop_token}\r\nConnection: close\r\n\r\n"
    )?;
    stream.flush()?;
    let mut status_line = String::new();
    BufReader::new(stream).read_line(&mut status_line)?;
    status_line
        .split_ascii_whitespace()
        .nth(1)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing HTTP status"))?
        .parse::<u16>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![dispatch_os_notification])
        .setup(|app| {
            let port = reserve_loopback_port()?;
            let desktop_token = Uuid::new_v4().simple().to_string();
            let executable_path = std::env::current_exe()?;
            let executable_directory = executable_path.parent().ok_or_else(|| {
                invalid_portable_layout("无法解析 ZeroTrace 可执行文件目录。")
            })?;
            let layout = resolve_runtime_layout(
                executable_directory,
                &app.path().resource_dir()?,
                &app.path().app_data_dir()?,
            )?;
            let sidecar = app
                .shell()
                .sidecar("zerotrace-api")?
                .current_dir(&layout.executable_directory)
                .env("NODE_ENV", "production")
                .env("HOST", "127.0.0.1")
                .env("API_PORT", port.to_string())
                .env("ZEROTRACE_DESKTOP_AUTH_TOKEN", &desktop_token)
                .env("ZEROTRACE_SWAGGER_UI", "false")
                .env("ZEROTRACE_STORAGE_ROOT", layout.data_root.as_os_str())
                .env(
                    "ZEROTRACE_PAPER_PORTFOLIO_CONFIG",
                    layout.paper_portfolio_config.as_os_str(),
                )
                .env(
                    "CORS_ORIGIN",
                    "http://tauri.localhost,https://tauri.localhost,tauri://localhost",
                );
            let (mut events, child) = sidecar.spawn()?;
            tauri::async_runtime::spawn(async move {
                while events.recv().await.is_some() {}
            });
            app.manage(ApiSidecar(Mutex::new(Some(child))));

            if std::env::var("ZEROTRACE_DESKTOP_NOTIFICATION_SMOKE").as_deref() == Ok("1") {
                show_system_notification(
                    app.handle(),
                    "ZeroTrace 模拟提醒测试",
                    "这是本机系统通知接口验收，不代表模拟成交或用户已查看。",
                )?;
                println!("ZEROTRACE_DESKTOP_NOTIFICATION_SMOKE=OS_API_ACCEPTED");
            }

            if !wait_for_loopback(port, Duration::from_secs(60)) {
                return Err(format!("只读 API sidecar 未能在本机动态端口 {port} 就绪").into());
            }

            if std::env::var("ZEROTRACE_DESKTOP_NOTIFICATION_SMOKE").as_deref() == Ok("1") {
                let health_status = authenticated_http_status(port, "/health", &desktop_token)?;
                if health_status != 200 {
                    return Err(format!("桌面 sidecar 认证健康检查失败：HTTP {health_status}").into());
                }
                println!("ZEROTRACE_DESKTOP_AUTH_SMOKE=HEALTH_200");
                let settings_status = authenticated_http_status(
                    port,
                    "/api/v1/settings/paper-simulation",
                    &desktop_token,
                )?;
                if settings_status != 200 {
                    return Err(
                        format!("便携版模拟资金配置检查失败：HTTP {settings_status}").into(),
                    );
                }
                println!("ZEROTRACE_PAPER_SETTINGS_SMOKE=HTTP_200");
            }

            let desktop_mode = if layout.portable {
                "PORTABLE"
            } else {
                "INSTALLED"
            };
            let initialization_script = format!(
                "Object.defineProperty(window, '__ZEROTRACE_API_URL__', {{ value: 'http://127.0.0.1:{port}', writable: false, configurable: false }}); Object.defineProperty(window, '__ZEROTRACE_DESKTOP_TOKEN__', {{ value: '{desktop_token}', writable: false, configurable: false }}); Object.defineProperty(window, '__ZEROTRACE_DESKTOP_MODE__', {{ value: '{desktop_mode}', writable: false, configurable: false }});"
            );
            let window_title = if layout.portable {
                "ZeroTrace 链上取证工作站 · 便携版"
            } else {
                "ZeroTrace 链上取证工作站"
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(window_title)
                .inner_size(1440.0, 920.0)
                .min_inner_size(960.0, 640.0)
                .initialization_script(&initialization_script)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ZeroTrace Tauri 初始化失败");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<ApiSidecar>() {
                if let Ok(mut child) = state.0.lock() {
                    if let Some(sidecar) = child.take() {
                        let _ = sidecar.kill();
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{resolve_runtime_layout, validate_notification_text, PORTABLE_MARKER_FILE};

    #[test]
    fn accepts_bounded_chinese_notification_text() {
        assert!(validate_notification_text("准备模拟买入", "标题", 120).is_ok());
    }

    #[test]
    fn rejects_empty_oversized_and_control_text() {
        assert!(validate_notification_text("", "标题", 120).is_err());
        assert!(validate_notification_text(&"字".repeat(121), "标题", 120).is_err());
        assert!(validate_notification_text("模拟\n提醒", "标题", 120).is_err());
    }

    #[test]
    fn portable_layout_requires_a_read_only_marker_and_adjacent_config() {
        let root =
            std::env::temp_dir().join(format!("zerotrace-portable-{}", uuid::Uuid::new_v4()));
        let resources = root.join("resources");
        let app_data = root.join("app-data");
        fs::create_dir_all(root.join("config")).expect("portable config directory");
        fs::create_dir_all(&resources).expect("resource directory");
        fs::write(
            root.join(PORTABLE_MARKER_FILE),
            r#"{"schemaVersion":"zerotrace-portable-v1","readOnly":true}"#,
        )
        .expect("portable marker");
        fs::write(root.join("config/paper_portfolios.json"), "{}").expect("portable config");

        let layout = resolve_runtime_layout(&root, &resources, &app_data).expect("portable layout");
        assert!(layout.portable);
        assert_eq!(layout.data_root, root.join("ZeroTrace-Data/storage-plane"));
        assert_eq!(
            layout.paper_portfolio_config,
            root.join("config/paper_portfolios.json")
        );
        fs::remove_dir_all(root).expect("remove portable layout fixture");
    }

    #[test]
    fn installed_layout_uses_resource_config_and_app_data() {
        let root =
            std::env::temp_dir().join(format!("zerotrace-installed-{}", uuid::Uuid::new_v4()));
        let executable = root.join("bin");
        let resources = root.join("resources");
        let app_data = root.join("app-data");
        fs::create_dir_all(resources.join("config")).expect("resource config directory");
        fs::create_dir_all(&executable).expect("executable directory");
        fs::write(resources.join("config/paper_portfolios.json"), "{}").expect("resource config");

        let layout =
            resolve_runtime_layout(&executable, &resources, &app_data).expect("installed layout");
        assert!(!layout.portable);
        assert_eq!(layout.data_root, app_data.join("storage-plane"));
        assert_eq!(
            layout.paper_portfolio_config,
            resources.join("config/paper_portfolios.json")
        );
        fs::remove_dir_all(root).expect("remove installed layout fixture");
    }
}
