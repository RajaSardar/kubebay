//! KB-14: the desktop smoke run CI does on Windows and Linux. Started with
//! `KUBEBAY_SMOKE=1`, the app tells the page so (`window.__KUBEBAY_SMOKE__`),
//! and exits 0 when the shell reports it has painted, or 1 if the engine never
//! comes up or the shell never reports within [`TIMEOUT`].

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How long the shell has to paint before the run fails.
pub const TIMEOUT: Duration = Duration::from_secs(90);

static ON: AtomicBool = AtomicBool::new(false);

/// Whether a `KUBEBAY_SMOKE` value turns the smoke run on.
pub fn enabled(value: Option<&str>) -> bool {
    matches!(value.map(str::trim), Some("1") | Some("true"))
}

/// Reads `KUBEBAY_SMOKE` once at start-up.
pub fn init_from_env() -> bool {
    let on = enabled(std::env::var("KUBEBAY_SMOKE").ok().as_deref());
    ON.store(on, Ordering::SeqCst);
    on
}

pub fn is_on() -> bool {
    ON.load(Ordering::SeqCst)
}

/// The page's initialisation script: the session token, and the smoke flag in a smoke run.
pub fn init_script(token_literal: &str, smoke: bool) -> String {
    let mut s = format!("window.__KUBEBAY_TOKEN__ = {token_literal};");
    if smoke {
        s.push_str(" window.__KUBEBAY_SMOKE__ = true;");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_1_or_true_turns_it_on() {
        assert!(enabled(Some("1")));
        assert!(enabled(Some("true")));
        assert!(enabled(Some(" 1 ")));
        assert!(!enabled(None));
        assert!(!enabled(Some("")));
        assert!(!enabled(Some("0")));
        assert!(!enabled(Some("yes")));
    }

    #[test]
    fn the_page_learns_it_is_a_smoke_run_only_in_one() {
        assert_eq!(
            init_script("\"tok\"", false),
            "window.__KUBEBAY_TOKEN__ = \"tok\";"
        );
        assert_eq!(
            init_script("\"tok\"", true),
            "window.__KUBEBAY_TOKEN__ = \"tok\"; window.__KUBEBAY_SMOKE__ = true;"
        );
    }
}
