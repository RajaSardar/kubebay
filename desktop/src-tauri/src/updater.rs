//! KB-04: the desktop app updates itself.
//!
//! - Only a build that carries the updater's public key can (release builds,
//!   once the key exists). Without one the plugin isn't loaded and nothing here
//!   runs: local builds and earlier releases never make the request.
//! - It checks one fixed URL ([`ENDPOINT`]) on launch and once a day, unless
//!   the user turns checks off in Settings. The request carries no identifiers:
//!   no query string, no cookies, no custom headers.
//! - An update is downloaded in the background and verified against the public
//!   key (and against the version it was signed for), then the page shows an
//!   "Update ready" banner. It installs only when the user asks, and never while
//!   the engine reports a terminal, port-forward or write in flight.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// The only address the updater ever fetches: the latest release's manifest.
pub const ENDPOINT: &str = "https://github.com/RajaSardar/kubebay/releases/latest/download/latest.json";

/// How long after launch the first check waits, so it never competes with start-up.
pub const FIRST_CHECK_AFTER: Duration = Duration::from_secs(30);

/// How often checks repeat while the app stays open.
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// Whether this build can update itself: its config carries the updater's
/// public key (`plugins.updater.pubkey`, set by release.yml).
pub fn build_has_key(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// The user's update preference, kept in the app config directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    /// Check on launch and once a day.
    pub auto_check: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { auto_check: true }
    }
}

/// The saved preference, or the default (checks on) when there's none or it can't be read.
pub fn load_prefs(path: &Path) -> Prefs {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_prefs(path: &Path, prefs: &Prefs) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string(prefs)?)
}

/// Where the updater is, as the page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Status {
    /// This build doesn't carry the updater's key.
    Unavailable,
    /// Not checked yet.
    Idle,
    /// Checking, and downloading if there's an update.
    Checking,
    #[serde(rename_all = "camelCase")]
    UpToDate { checked_at: u64 },
    /// Downloaded and verified; installs when the user asks.
    Ready { version: String, notes: Option<String> },
    /// A newer version exists, but Homebrew installed this copy: `brew upgrade` it.
    Homebrew { version: String },
    /// The release has no update bundle for this kind of install (a .deb, say).
    Manual,
    #[serde(rename_all = "camelCase")]
    Failed { error: String, checked_at: u64 },
}

/// A downloaded, verified update waiting for the user.
pub struct Pending {
    pub update: tauri_plugin_updater::Update,
    pub bytes: Vec<u8>,
}

/// Checks `endpoint` once and, if there's a newer version, downloads and
/// verifies it. A copy installed by Homebrew only reports the version.
pub async fn check_once<R: Runtime>(
    app: &AppHandle<R>,
    endpoint: &str,
    homebrew: bool,
    now_ms: u64,
) -> (Status, Option<Pending>) {
    let failed = |e: String| Status::Failed { error: e, checked_at: now_ms };
    let updater = match endpoint
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())
        .and_then(|url| {
            app.updater_builder()
                .endpoints(vec![url])
                .and_then(|b| b.timeout(Duration::from_secs(60)).build())
                .map_err(|e| e.to_string())
        }) {
        Ok(u) => u,
        Err(e) => return (failed(e), None),
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return (Status::UpToDate { checked_at: now_ms }, None),
        Err(tauri_plugin_updater::Error::TargetsNotFound(_)) => return (Status::Manual, None),
        Err(e) => return (failed(e.to_string()), None),
    };
    if homebrew {
        return (Status::Homebrew { version: update.version.clone() }, None);
    }
    // download() verifies the signature, and the version it was signed for,
    // before it returns the bytes.
    match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => {
            let status = Status::Ready { version: update.version.clone(), notes: update.body.clone() };
            (status, Some(Pending { update, bytes }))
        }
        Err(e) => (failed(e.to_string()), None),
    }
}

/// What the page reads with `update_status`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusView {
    pub current_version: String,
    pub auto_check: bool,
    #[serde(flatten)]
    pub status: Status,
}

struct Inner {
    status: Status,
    pending: Option<Pending>,
    prefs: Prefs,
}

/// The updater's state, shared by the scheduled checks and the page's commands.
pub struct Updates {
    inner: std::sync::Mutex<Inner>,
    prefs_path: Option<std::path::PathBuf>,
}

impl Updates {
    /// `available`: this build carries the updater's key ([`build_has_key`]).
    pub fn new(available: bool, prefs_path: Option<std::path::PathBuf>) -> Self {
        let prefs = prefs_path.as_deref().map(load_prefs).unwrap_or_default();
        let status = if available { Status::Idle } else { Status::Unavailable };
        Updates { inner: std::sync::Mutex::new(Inner { status, pending: None, prefs }), prefs_path }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn view(&self, current_version: &str) -> StatusView {
        let inner = self.lock();
        StatusView { current_version: current_version.to_string(), auto_check: inner.prefs.auto_check, status: inner.status.clone() }
    }

    pub fn auto_check(&self) -> bool {
        self.lock().prefs.auto_check
    }

    pub fn set_auto_check(&self, on: bool) -> std::io::Result<()> {
        let mut inner = self.lock();
        inner.prefs.auto_check = on;
        match &self.prefs_path {
            Some(path) => save_prefs(path, &inner.prefs),
            None => Ok(()),
        }
    }

    /// Marks a check as started. False when this build can't update, a check
    /// is already running, or an update is already downloaded and waiting.
    pub fn begin_check(&self) -> bool {
        let mut inner = self.lock();
        match inner.status {
            Status::Unavailable | Status::Checking | Status::Ready { .. } => false,
            _ => {
                inner.status = Status::Checking;
                true
            }
        }
    }

    pub fn finish_check(&self, status: Status, pending: Option<Pending>) {
        let mut inner = self.lock();
        inner.status = status;
        inner.pending = pending;
    }

    /// The downloaded update, for installing. [`Updates::put_back`] returns it if the install fails.
    pub fn take_pending(&self) -> Option<Pending> {
        self.lock().pending.take()
    }

    pub fn put_back(&self, pending: Pending) {
        self.lock().pending = Some(pending);
    }
}

/// What the engine says a restart would interrupt (`GET /api/activity`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub terminals: u32,
    pub port_forwards: u32,
    pub writes: u32,
}

/// Why the app won't restart right now, in words for the banner; None when nothing is in flight.
pub fn restart_blocker(a: &Activity) -> Option<String> {
    let count = |n: u32, one: &str, many: &str| match n {
        0 => None,
        1 => Some(format!("1 {one}")),
        n => Some(format!("{n} {many}")),
    };
    let parts: Vec<String> = [
        count(a.terminals, "terminal session", "terminal sessions"),
        count(a.port_forwards, "port-forward", "port-forwards"),
        count(a.writes, "change being applied", "changes being applied"),
    ]
    .into_iter()
    .flatten()
    .collect();
    let total = a.terminals + a.port_forwards + a.writes;
    let list = match parts.as_slice() {
        [] => return None,
        [one] => one.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    };
    let when = if total == 1 { "it's" } else { "they're" };
    Some(format!("Kubebay didn't restart: {list} would be cut off. Restart when {when} finished."))
}

/// Parses the engine's HTTP/1.0 response to `GET /api/activity`.
pub fn parse_activity_response(raw: &str) -> Result<Activity, String> {
    let (head, body) = raw.split_once("\r\n\r\n").ok_or("the engine's reply had no body")?;
    let status = head.lines().next().unwrap_or_default();
    if status.split_whitespace().nth(1) != Some("200") {
        return Err(format!("the engine answered {status}"));
    }
    serde_json::from_str(body.trim()).map_err(|e| format!("the engine's reply wasn't activity: {e}"))
}

/// Asks the engine at `addr` what a restart would interrupt. HTTP/1.0, so the
/// reply is never chunked and ends when the engine closes the connection.
pub fn fetch_activity(addr: &str, token: &str) -> Result<Activity, String> {
    use std::io::{Read, Write};
    let unreachable = |e: std::io::Error| format!("couldn't ask the engine what's running: {e}");
    let sock: std::net::SocketAddr = addr.parse().map_err(|e| format!("engine address {addr}: {e}"))?;
    let mut s = std::net::TcpStream::connect_timeout(&sock, Duration::from_secs(2)).map_err(unreachable)?;
    s.set_read_timeout(Some(Duration::from_secs(5))).map_err(unreachable)?;
    write!(s, "GET /api/activity HTTP/1.0\r\nHost: {addr}\r\nX-Kubebay-Token: {token}\r\n\r\n").map_err(unreachable)?;
    let mut raw = String::new();
    s.read_to_string(&mut raw).map_err(unreachable)?;
    parse_activity_response(&raw)
}

/// Whether Homebrew installed this copy as a cask: the cask's directory exists.
pub fn installed_by_homebrew(exists: impl Fn(&Path) -> bool) -> bool {
    ["/opt/homebrew/Caskroom/kubebay", "/usr/local/Caskroom/kubebay"]
        .iter()
        .any(|p| exists(Path::new(p)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    // ── Pure parts ───────────────────────────────────────────────────────────

    #[test]
    fn the_endpoint_is_one_fixed_https_url_with_no_identifiers() {
        let url: tauri::Url = ENDPOINT.parse().unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert_eq!(url.query(), None);
        assert_eq!(url.fragment(), None);
        // No {{current_version}}, {{target}} or {{arch}} for the plugin to fill in.
        assert!(!ENDPOINT.contains("{{"), "{ENDPOINT}");
    }

    #[test]
    fn only_a_build_with_a_public_key_updates_itself() {
        let mut config = tauri::Config::default();
        assert!(!build_has_key(&config));
        config.plugins.0.insert("updater".into(), serde_json::json!({ "pubkey": "" }));
        assert!(!build_has_key(&config));
        config.plugins.0.insert("updater".into(), serde_json::json!({ "pubkey": "dW50cnVzdGVk" }));
        assert!(build_has_key(&config));
    }

    #[test]
    fn checks_are_on_until_the_user_turns_them_off() {
        let dir = std::env::temp_dir().join(format!("kb-updates-{}", std::process::id()));
        let path = dir.join("updates.json");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load_prefs(&path), Prefs { auto_check: true });
        save_prefs(&path, &Prefs { auto_check: false }).unwrap();
        assert_eq!(load_prefs(&path), Prefs { auto_check: false });
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(load_prefs(&path), Prefs { auto_check: true });
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn says_what_a_restart_would_interrupt() {
        assert_eq!(restart_blocker(&Activity::default()), None);
        assert_eq!(
            restart_blocker(&Activity { terminals: 1, ..Default::default() }).as_deref(),
            Some("Kubebay didn't restart: 1 terminal session would be cut off. Restart when it's finished.")
        );
        assert_eq!(
            restart_blocker(&Activity { terminals: 2, port_forwards: 1, writes: 0 }).as_deref(),
            Some("Kubebay didn't restart: 2 terminal sessions and 1 port-forward would be cut off. Restart when they're finished.")
        );
        assert_eq!(
            restart_blocker(&Activity { terminals: 1, port_forwards: 3, writes: 1 }).as_deref(),
            Some("Kubebay didn't restart: 1 terminal session, 3 port-forwards and 1 change being applied would be cut off. Restart when they're finished.")
        );
    }

    #[test]
    fn reads_the_engines_activity_response() {
        let ok = "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nContent-Length: 46\r\n\r\n{\"terminals\":1,\"portForwards\":2,\"writes\":0}\n";
        assert_eq!(parse_activity_response(ok), Ok(Activity { terminals: 1, port_forwards: 2, writes: 0 }));
        let denied = "HTTP/1.0 401 Unauthorized\r\n\r\nunauthorized\n";
        assert!(parse_activity_response(denied).unwrap_err().contains("401"));
    }

    #[test]
    fn asks_the_engine_with_its_session_token() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let seen = Arc::new(Mutex::new(String::new()));
        let seen2 = seen.clone();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            *seen2.lock().unwrap() = read_request(&mut s);
            let body = r#"{"terminals":0,"portForwards":1,"writes":0}"#;
            let _ = write!(s, "HTTP/1.0 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        });
        assert_eq!(fetch_activity(&addr, "tok-123"), Ok(Activity { terminals: 0, port_forwards: 1, writes: 0 }));
        let req = seen.lock().unwrap().clone();
        assert!(req.starts_with("GET /api/activity HTTP/1.0\r\n"), "{req}");
        assert!(req.to_ascii_lowercase().contains("x-kubebay-token: tok-123\r\n"), "{req}");
        assert!(fetch_activity("127.0.0.1:1", "t").is_err());
    }

    #[test]
    fn spots_a_homebrew_cask_install() {
        assert!(!installed_by_homebrew(|_| false));
        assert!(installed_by_homebrew(|p| p == Path::new("/opt/homebrew/Caskroom/kubebay")));
        assert!(installed_by_homebrew(|p| p == Path::new("/usr/local/Caskroom/kubebay")));
    }

    // ── The state the commands share ────────────────────────────────────────

    fn prefs_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kb-updates-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("updates.json")
    }

    #[test]
    fn a_build_without_a_key_never_checks() {
        let u = Updates::new(false, Some(prefs_path("nokey")));
        assert!(!u.begin_check());
        let v = serde_json::to_value(u.view("0.8.0")).unwrap();
        assert_eq!(v, serde_json::json!({ "state": "unavailable", "currentVersion": "0.8.0", "autoCheck": true }));
    }

    #[test]
    fn one_check_at_a_time_and_none_once_an_update_is_ready() {
        let u = Updates::new(true, None);
        assert_eq!(serde_json::to_value(u.view("0.8.0")).unwrap()["state"], "idle");
        assert!(u.begin_check());
        assert!(!u.begin_check(), "a second check while one runs");
        assert_eq!(serde_json::to_value(u.view("0.8.0")).unwrap()["state"], "checking");
        u.finish_check(Status::UpToDate { checked_at: 7 }, None);
        let v = serde_json::to_value(u.view("0.8.0")).unwrap();
        assert_eq!(v["state"], "up-to-date");
        assert_eq!(v["checkedAt"], 7);
        assert!(u.begin_check(), "checks again once the last one finished");
        u.finish_check(Status::Ready { version: "0.8.1".into(), notes: None }, None);
        assert!(!u.begin_check(), "an update is ready: don't download it again");
    }

    #[test]
    fn turning_checks_off_is_saved() {
        let path = prefs_path("toggle");
        let u = Updates::new(true, Some(path.clone()));
        assert!(u.auto_check());
        u.set_auto_check(false).unwrap();
        assert!(!u.auto_check());
        assert_eq!(load_prefs(&path), Prefs { auto_check: false });
        assert!(!Updates::new(true, Some(path.clone())).auto_check(), "the next launch reads it");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    // ── The plugin against a local server ───────────────────────────────────

    struct Keys {
        pk: minisign::PublicKey,
        sk: minisign::SecretKey,
    }

    impl Keys {
        fn new() -> Self {
            let kp = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
            Keys { pk: kp.pk, sk: kp.sk }
        }
        /// The public key as the updater config carries it.
        fn pubkey(&self) -> String {
            b64(&self.pk.to_box().unwrap().into_string())
        }
        /// A signature as `tauri signer sign` writes it, for `version`.
        fn sign(&self, data: &[u8], version: &str) -> String {
            let comment = format!("timestamp:1700000000\tfile:bundle.tar.gz\tversion:{version}");
            let sig = minisign::sign(Some(&self.pk), &self.sk, data, Some(&comment), Some("signature from tauri secret key")).unwrap();
            b64(&sig.into_string())
        }
    }

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s)
    }

    fn read_request(s: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut byte = [0u8; 1];
        while !buf.ends_with(b"\r\n\r\n") {
            if s.read(&mut byte).unwrap_or(0) == 0 {
                break;
            }
            buf.push(byte[0]);
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    fn app(pubkey: &str, version: &str) -> tauri::App<tauri::test::MockRuntime> {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({ "pubkey": pubkey, "requireSignedVersion": true, "dangerousInsecureTransportProtocol": true }),
        );
        ctx.package_info_mut().version = version.parse().unwrap();
        tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(ctx)
            .unwrap()
    }

    fn manifest(base: &str, version: &str, target: &str, signature: &str) -> Vec<u8> {
        serde_json::json!({
            "version": version,
            "notes": "https://github.com/RajaSardar/kubebay/releases/tag/v0.8.1",
            "pub_date": "2026-11-02T10:00:00Z",
            "platforms": { target: { "url": format!("{base}/bundle.tar.gz"), "signature": signature } }
        })
        .to_string()
        .into_bytes()
    }

    fn here() -> String {
        format!("{}-{}", if cfg!(target_os = "macos") { "darwin" } else if cfg!(windows) { "windows" } else { "linux" }, std::env::consts::ARCH)
    }

    fn check(app: &tauri::App<tauri::test::MockRuntime>, base: &str, homebrew: bool) -> (Status, Option<Pending>) {
        tauri::async_runtime::block_on(check_once(app.handle(), &format!("{base}/latest.json"), homebrew, 42))
    }

    #[test]
    fn the_check_sends_no_identifiers() {
        let keys = Keys::new();
        let (base, seen) = serve_with_self(vec![("/latest.json", 204, vec![])]);
        let (status, pending) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert_eq!(status, Status::UpToDate { checked_at: 42 });
        assert!(pending.is_none());
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("GET /latest.json HTTP/1.1\r\n"), "{req}");
        for line in req.lines().skip(1).filter(|l| !l.is_empty()) {
            let name = line.split(':').next().unwrap().to_ascii_lowercase();
            assert!(["host", "accept", "user-agent", "accept-encoding"].contains(&name.as_str()), "unexpected header: {line}");
            if name == "user-agent" {
                assert!(line.to_ascii_lowercase().contains("tauri-plugin-updater/"), "{line}");
            }
        }
    }

    #[test]
    fn downloads_and_verifies_a_signed_update() {
        let keys = Keys::new();
        let bundle = b"kubebay 0.8.1".to_vec();
        let sig = keys.sign(&bundle, "0.8.1");
        let (base, _) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.8.1", &here(), &sig)), ("/bundle.tar.gz", 200, bundle.clone())]);
        let (status, pending) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert_eq!(status, Status::Ready { version: "0.8.1".into(), notes: Some("https://github.com/RajaSardar/kubebay/releases/tag/v0.8.1".into()) });
        assert_eq!(pending.expect("pending").bytes, bundle);
    }

    #[test]
    fn rejects_a_tampered_bundle() {
        let keys = Keys::new();
        let sig = keys.sign(b"kubebay 0.8.1", "0.8.1");
        let (base, _) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.8.1", &here(), &sig)), ("/bundle.tar.gz", 200, b"something else".to_vec())]);
        let (status, pending) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert!(matches!(&status, Status::Failed { error, .. } if error.to_lowercase().contains("signature")), "{status:?}");
        assert!(pending.is_none());
    }

    #[test]
    fn rejects_a_signature_from_another_key() {
        let keys = Keys::new();
        let other = Keys::new();
        let bundle = b"kubebay 0.8.1".to_vec();
        let (base, _) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.8.1", &here(), &other.sign(&bundle, "0.8.1"))), ("/bundle.tar.gz", 200, bundle)]);
        let (status, pending) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert!(matches!(&status, Status::Failed { error, .. } if error.contains("different key")), "{status:?}");
        assert!(pending.is_none());
    }

    #[test]
    fn rejects_an_old_release_announced_as_a_new_version() {
        // A genuine 0.8.1 bundle and signature, replayed as "0.9.0".
        let keys = Keys::new();
        let bundle = b"kubebay 0.8.1".to_vec();
        let (base, _) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.9.0", &here(), &keys.sign(&bundle, "0.8.1"))), ("/bundle.tar.gz", 200, bundle)]);
        let (status, pending) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert!(matches!(&status, Status::Failed { error, .. } if error.contains("signed for version 0.8.1")), "{status:?}");
        assert!(pending.is_none());
    }

    #[test]
    fn an_older_or_equal_release_is_up_to_date() {
        let keys = Keys::new();
        let bundle = b"kubebay 0.8.0".to_vec();
        let (base, seen) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.8.0", &here(), &keys.sign(&bundle, "0.8.0"))), ("/bundle.tar.gz", 200, bundle)]);
        let (status, _) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert_eq!(status, Status::UpToDate { checked_at: 42 });
        assert_eq!(seen.lock().unwrap().len(), 1, "nothing was downloaded");
    }

    #[test]
    fn a_homebrew_copy_reports_the_version_without_downloading() {
        let keys = Keys::new();
        let bundle = b"kubebay 0.8.1".to_vec();
        let (base, seen) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.8.1", &here(), &keys.sign(&bundle, "0.8.1"))), ("/bundle.tar.gz", 200, bundle)]);
        let (status, pending) = check(&app(&keys.pubkey(), "0.8.0"), &base, true);
        assert_eq!(status, Status::Homebrew { version: "0.8.1".into() });
        assert!(pending.is_none());
        assert_eq!(seen.lock().unwrap().len(), 1, "nothing was downloaded");
    }

    #[test]
    fn a_release_without_a_bundle_for_this_install_is_manual() {
        let keys = Keys::new();
        let bundle = b"kubebay 0.8.1".to_vec();
        let (base, _) = serve_with_self(vec![("/latest.json", 200, manifest("{base}", "0.8.1", "plan9-mips", &keys.sign(&bundle, "0.8.1")))]);
        let (status, _) = check(&app(&keys.pubkey(), "0.8.0"), &base, false);
        assert_eq!(status, Status::Manual);
    }

    /// Serves `routes` (path → status and body), with `{base}` in each body
    /// replaced by the server's own address, and records each request.
    fn serve_with_self(routes: Vec<(&'static str, u16, Vec<u8>)>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let routes: Vec<_> = routes
            .into_iter()
            .map(|(p, s, b)| (p, s, String::from_utf8_lossy(&b).replace("{base}", &base).into_bytes()))
            .collect();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { return };
                let req = read_request(&mut s);
                let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                seen2.lock().unwrap().push(req);
                let (status, body) = routes
                    .iter()
                    .find(|(p, _, _)| *p == path)
                    .map(|(_, st, b)| (*st, b.clone()))
                    .unwrap_or((404, b"not found".to_vec()));
                let _ = write!(s, "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = s.write_all(&body);
            }
        });
        (base, seen)
    }
}
