//! ZeroTrace production desktop host.
//! Read-only invariants are preserved: no private keys, signing, broadcasting, or fund movement.

use std::io;
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

struct ApiSidecar(Mutex<Option<CommandChild>>);

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
            let data_root = app.path().app_data_dir()?.join("storage-plane");
            std::fs::create_dir_all(&data_root)?;
            let sidecar = app
                .shell()
                .sidecar("zerotrace-api")?
                .env("NODE_ENV", "production")
                .env("HOST", "127.0.0.1")
                .env("API_PORT", port.to_string())
                .env("ZEROTRACE_DESKTOP_AUTH_TOKEN", &desktop_token)
                .env("ZEROTRACE_SWAGGER_UI", "false")
                .env("ZEROTRACE_STORAGE_ROOT", data_root.as_os_str())
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

            let initialization_script = format!(
                "Object.defineProperty(window, '__ZEROTRACE_API_URL__', {{ value: 'http://127.0.0.1:{port}', writable: false, configurable: false }}); Object.defineProperty(window, '__ZEROTRACE_DESKTOP_TOKEN__', {{ value: '{desktop_token}', writable: false, configurable: false }});"
            );
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("ZeroTrace 只读工作站")
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
    use super::validate_notification_text;

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
}
