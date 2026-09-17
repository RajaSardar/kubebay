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
    let port: u16 = addr.rsplit_once(':').and_then(|(_, p)| p.parse().ok()).unwrap_or(9898);
    for i in 0..attempts {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250u64 + (i % 4) as u64 * 100));
    }
    false
}

fn pick_free_port() -> u16 {
    // Prefer a stable port so localStorage origin stays consistent across launches
    // (WebviewUrl::External keys localStorage by http://host:port).
    const PREFERRED: u16 = 9898;
    if std::net::TcpListener::bind(("127.0.0.1", PREFERRED)).is_ok() {
        return PREFERRED;
    }
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(PREFERRED + 1)
}

/// Environment the engine sidecar is allowed to inherit from the user's login
/// shell.  This is an ALLOWLIST on purpose — never copy the whole environment.
///
/// GUI apps launched from the Dock/Finder are started by launchd, not a shell,
/// so they inherit a stripped environment.  PATH matters because Kubernetes
/// exec credential plugins (aws eks get-token, gke-gcloud-auth-plugin…) live in
/// Homebrew or custom bin dirs.  The rest matter because those plugins read
/// them to decide WHICH IDENTITY to authenticate as: without AWS_PROFILE, for
/// example, `aws eks get-token` silently falls back to the `default` profile,
/// so Kubebay would talk to production as a different — possibly far more
/// privileged — identity than the user's own terminal does, with no visible
/// sign of the substitution.  Proxy and CA vars are here for the same reason:
/// dropping them changes which endpoint is trusted and reached.
const FORWARDED_ENV: &[&str] = &[
    "PATH",
    "KUBECONFIG",
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_SDK_LOAD_CONFIG",
    "AWS_ROLE_SESSION_NAME",
    "CLOUDSDK_CONFIG",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "AZURE_CONFIG_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "KRB5CCNAME",
];

/// Read the whole allowlist from the user's login shell in ONE invocation.
///
/// The shell prints `NAME=VALUE\0` records for the variables that are actually
/// set, using only builtins, so this costs a single process for ~20 variables
/// rather than one login shell each.  NUL separation keeps values containing
/// newlines or spaces intact.
#[cfg(unix)]
fn login_shell_env() -> Vec<(String, String)> {
    let mut script = String::from("for __kb_v in ");
    script.push_str(&FORWARDED_ENV.join(" "));
    script.push_str(
        "; do eval \"if [ -n \\\"\\${$__kb_v+x}\\\" ]; then printf '%s=%s\\\\0' \\\"\\$__kb_v\\\" \\\"\\${$__kb_v}\\\"; fi\"; done",
    );

    // Prefer the user's configured shell, then the macOS/Linux defaults.
    // -l (login) so ~/.zprofile / ~/.bash_profile are sourced.
    let configured = std::env::var("SHELL").unwrap_or_default();
    let mut shells: Vec<&str> = Vec::new();
    if !configured.is_empty() {
        shells.push(&configured);
    }
    for s in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if !shells.contains(&s) {
            shells.push(s);
        }
    }

    for shell in shells {
        let Ok(out) = std::process::Command::new(shell)
            .args(["-l", "-c", &script])
            .output()
        else {
            continue;
        };
        let vars = parse_env_records(&String::from_utf8_lossy(&out.stdout));
        if !vars.is_empty() {
            return vars;
        }
    }
    Vec::new()
}

/// Windows GUI apps inherit the user's environment already.
#[cfg(not(unix))]
fn login_shell_env() -> Vec<(String, String)> {
    Vec::new()
}

fn parse_env_records(stdout: &str) -> Vec<(String, String)> {
    stdout
        .split('\0')
        .filter_map(|rec| rec.split_once('='))
        .filter(|(name, value)| FORWARDED_ENV.contains(name) && !value.is_empty())
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

fn kill_engine() {
    if let Some(cell) = ENGINE_CHILD.get() {
        if let Ok(mut guard) = cell.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

fn main() {
    ENGINE_CHILD.get_or_init(|| Mutex::new(None));

    // Kill the engine sidecar on Ctrl-C / SIGTERM so it never orphans.
    ctrlc::set_handler(|| {
        kill_engine();
        std::process::exit(0);
    })
    .ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let port = pick_free_port();
            let addr = format!("127.0.0.1:{port}");
            let mut cmd = app.shell().sidecar("kubebay-engine")?.args(["--addr", &addr]);
            let forwarded = login_shell_env();
            for (name, value) in &forwarded {
                cmd = cmd.env(name.as_str(), value.as_str());
            }
            // Names only — values can be credential paths.  Logged so a user
            // debugging "why is Kubebay using a different identity than my
            // terminal" can see what the engine actually received.
            eprintln!(
                "[kubebay] forwarded login-shell env: {}",
                if forwarded.is_empty() {
                    "(none)".to_string()
                } else {
                    forwarded
                        .iter()
                        .map(|(n, _)| n.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            );

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

                if token.is_empty() || !wait_for_engine(&addr, 40) {
                    eprintln!("[kubebay] engine failed to become ready");
                    return;
                }
                std::thread::sleep(Duration::from_millis(300));

                let url = format!("http://{addr}/?token={token}")
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
        .run(|_app_handle, event| match event {
            // Window closed (red ✕ button or ⌘W) — kill engine immediately.
            tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                kill_engine();
            }
            // App fully exiting — belt-and-suspenders kill + flush stdout.
            tauri::RunEvent::Exit => {
                kill_engine();
                let _ = std::io::stdout().flush();
            }
            _ => {}
        });
}
