//! Read-only desktop host. Signing, broadcasting, and private keys are forbidden.
//!
//! This binary is a workspace pointer: it starts or attaches to `npm run dev` in the
//! live checkout. Web/API source changes hot-reload; the EXE is rebuilt only when
//! launcher sources change.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use zerotrace_desktop_core::launcher::{
    endpoint_url, load_dev_link, parse_workspace_pointer, plan_launch, require_node_modules,
    resolve_workspace, tcp_open, DevLink, LaunchAction, ResolveInputs, WorkspacePointer,
    SIDECAR_FILE_NAME,
};

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    configure_console();
    println!("ZeroTrace 只读工作站启动器");
    println!("本程序不打包前端或 API；始终联动当前工作区源码。");

    let exe = env::current_exe()?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "无法解析启动器目录"))?;
    let cwd = env::current_dir()?;
    let env_root = env::var_os("ZEROTRACE_ROOT").map(PathBuf::from);
    let pointer = load_sidecar(exe_dir)?;

    let root = resolve_workspace(ResolveInputs {
        env_root: env_root.as_deref(),
        pointer: pointer.as_ref(),
        exe_dir: Some(exe_dir),
        cwd: Some(&cwd),
    })?;
    let link = load_dev_link(&root)?;
    let probe = Duration::from_millis(300);
    let web_up = tcp_open(&link.web, probe);
    let api_up = tcp_open(&link.api, probe);
    let plan = plan_launch(root, web_up, api_up)?;

    println!("工作区: {}", plan.workspace_root.display());
    println!("工作站: {}", plan.web_url);
    println!("API 探活: {}", endpoint_url(&plan.link.api));

    match plan.action {
        LaunchAction::AttachExisting => {
            println!("已检测到开发服务，附加到现有进程（不重复启动）。");
            open_browser(&plan.web_url);
            println!("源码变更由 Vite 热更新，无需重新生成本启动器。");
        }
        LaunchAction::SpawnDev => {
            require_node_modules(&plan.workspace_root)?;
            warn_if_env_missing(&plan.workspace_root);
            println!(
                "正在启动 `{} {}`（与开发端同一命令，热更新生效）。",
                plan.link.spawn.program,
                plan.link.spawn.args.join(" ")
            );
            spawn_and_wait(&plan.workspace_root, &plan.link, &plan.web_url)?;
        }
    }
    Ok(())
}

fn load_sidecar(exe_dir: &Path) -> Result<Option<WorkspacePointer>, Box<dyn std::error::Error>> {
    let path = exe_dir.join(SIDECAR_FILE_NAME);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    match parse_workspace_pointer(&text) {
        Ok(pointer) => Ok(Some(pointer)),
        Err(err) => {
            eprintln!("工作区指针无法使用（{err}），改为扫描启动器目录。");
            Ok(None)
        }
    }
}

fn warn_if_env_missing(root: &Path) {
    if !root.join(".env").is_file() {
        println!("未找到 .env，API 将按缺省配置启动；提供方可保持未配置，Unknown 不得当作 0。");
    }
}

fn spawn_and_wait(
    root: &Path,
    link: &DevLink,
    web_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut child = spawn_dev(root, link)?;
    let timeout = Duration::from_millis(link.wait_timeout_ms.max(1_000));
    let poll = Duration::from_millis(link.poll_interval_ms.max(100));
    let deadline = Instant::now() + timeout;
    let mut opened = false;
    loop {
        if !opened
            && tcp_open(&link.web, Duration::from_millis(200))
            && tcp_open(&link.api, Duration::from_millis(200))
        {
            println!("开发服务已就绪，打开工作站。关闭本窗口会结束本次 npm run dev。");
            open_browser(web_url);
            opened = true;
        }
        if let Some(status) = child.try_wait()? {
            if !opened {
                return Err(format!("开发服务在工作站就绪前退出，状态 {status}").into());
            }
            println!("开发服务已退出，状态 {status}");
            return Ok(());
        }
        if !opened && Instant::now() > deadline {
            kill_child_tree(&mut child);
            return Err(
                "等待 API/Web 超时。请在本窗口查看 npm 输出，或手动运行 npm run dev。".into(),
            );
        }
        thread::sleep(poll);
    }
}

fn spawn_dev(root: &Path, link: &DevLink) -> io::Result<Child> {
    let mut command = if cfg!(windows) {
        let mut cmdline = windows_spawn_program(&link.spawn.program);
        for arg in &link.spawn.args {
            cmdline.push(' ');
            cmdline.push_str(arg);
        }
        let mut cmd = Command::new("cmd");
        cmd.args(["/D", "/S", "/C", &cmdline]);
        cmd
    } else {
        let mut cmd = Command::new(&link.spawn.program);
        cmd.args(&link.spawn.args);
        cmd
    };
    command
        .current_dir(root)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
}

fn windows_spawn_program(program: &str) -> String {
    if program.eq_ignore_ascii_case("npm") {
        "npm.cmd".to_string()
    } else {
        program.to_string()
    }
}

fn kill_child_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn open_browser(url: &str) {
    let result = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    };
    match result {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!("浏览器启动返回 {status}，请手动打开 {url}"),
        Err(err) => eprintln!("无法打开浏览器（{err}），请手动打开 {url}"),
    }
}

fn configure_console() {
    #[cfg(windows)]
    win_console::enable_utf8();
    let _ = io::stdout().flush();
}

#[cfg(windows)]
mod win_console {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetConsoleOutputCP(code: u32) -> i32;
        fn SetConsoleCP(code: u32) -> i32;
    }

    pub fn enable_utf8() {
        unsafe {
            SetConsoleOutputCP(65001);
            SetConsoleCP(65001);
        }
    }
}
