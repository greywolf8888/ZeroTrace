//! ZeroTrace production desktop host.
//! Read-only invariants are preserved: no private keys, signing, broadcasting, or fund movement.

use std::io;
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

struct ApiSidecar(Mutex<Option<CommandChild>>);

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
