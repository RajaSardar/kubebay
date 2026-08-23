use std::io::Write;
use std::net::TcpStream;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

static ENGINE_CHILD: OnceLock<Mutex<Option<CommandChild>>> = OnceLock::new();

fn parse_token(line: &str) -> Option<String> {
    let idx = line.find("token=")?;
    let rest = line[idx + "token=".len()..].trim();
    let end = rest
        .find(char::is_whitespace)
        .unwrap_or(rest.len());
    let token = rest[..end].trim_matches('"').to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn wait_for_engine(addr: &str, attempts: u32) -> bool {
    let host = addr.rsplit_once(':').map(|(h, _)| h).unwrap_or("127.0.0.1");
    let port: u16 = addr
        .rsplit_once(':')
        .and_then(|(_, p)| p.parse().ok())
        .unwrap_or(9898);
    for i in 0..attempts {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250u64 + (i % 4) as u64 * 100));
    }
    false
}

fn main() {
    ENGINE_CHILD.get_or_init(|| Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let cmd = app.shell().sidecar("kubebay-engine")?.args([
                "--addr",
                "127.0.0.1:9898",
            ]);

            let (mut rx, child) = cmd.spawn()?;
            *ENGINE_CHILD
                .get()
                .expect("engine child cell")
                .lock()
                .expect("lock") = Some(child);

            tauri::async_runtime::spawn(async move {
                let mut token = String::new();
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line).to_string();
                            eprintln!("[engine] {}", text.trim_end());
                            if token.is_empty() {
                                if let Some(t) = parse_token(&text) {
                                    token = t;
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[engine] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Terminated(_) => break,
                        _ => {}
                    }
                    if !token.is_empty() {
                        break;
                    }
                }

                if token.is_empty() || !wait_for_engine("127.0.0.1:9898", 40) {
                    eprintln!("[kubebay] engine failed to become ready");
                    return;
                }
                std::thread::sleep(Duration::from_millis(300));

                let url = format!("http://127.0.0.1:9898/?token={token}")
                    .parse()
                    .expect("valid url");

                let h2 = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = WebviewWindowBuilder::new(
                        &h2,
                        "main",
                        WebviewUrl::External(url),
                    )
                    .title("Kubebay")
                    .inner_size(1320.0, 850.0)
                    .min_inner_size(980.0, 620.0)
                    .build();
                });
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building kubebay")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(cell) = ENGINE_CHILD.get() {
                    if let Ok(mut guard) = cell.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                            let _ = std::io::stdout().flush();
                        }
                    }
                }
            }
        });
}
