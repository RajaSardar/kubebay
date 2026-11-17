//! Backlog 26 phase 1: several windows against the one engine. The pure rules:
//! what to call a new window, and when closing a window should stop the engine.

/// The first window's label; the capability files grant it the app's commands.
pub const MAIN_LABEL: &str = "main";

/// Prefix of every later window's label. The capability files grant `win-*` the
/// same commands as `main`.
pub const EXTRA_PREFIX: &str = "win-";

/// A label no open window has: `main` while it is free, then `win-2`, `win-3`...
pub fn next_label(open: &[String]) -> String {
    if !open.iter().any(|l| l == MAIN_LABEL) {
        return MAIN_LABEL.to_string();
    }
    let mut n = 2u32;
    loop {
        let label = format!("{EXTRA_PREFIX}{n}");
        if !open.iter().any(|l| *l == label) {
            return label;
        }
        n += 1;
    }
}

/// Whether the engine should stop now that `destroyed` has closed: only when
/// no other window is still open. `open` may or may not still list `destroyed`
/// (it depends on when the runtime drops it), so it is ignored either way.
pub fn engine_should_stop(open: &[String], destroyed: &str) -> bool {
    !open.iter().any(|l| l != destroyed)
}

/// Whether clicking the Dock icon should open a window: only when none is
/// visible (otherwise macOS just brings the existing ones forward).
pub fn open_on_reopen(has_visible_windows: bool) -> bool {
    !has_visible_windows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clicking_the_dock_icon_with_no_window_open_opens_one() {
        assert!(open_on_reopen(false));
        assert!(!open_on_reopen(true));
    }

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_first_window_is_main() {
        assert_eq!(next_label(&[]), "main");
    }

    #[test]
    fn later_windows_get_the_lowest_free_number() {
        assert_eq!(next_label(&v(&["main"])), "win-2");
        assert_eq!(next_label(&v(&["main", "win-2"])), "win-3");
        assert_eq!(next_label(&v(&["main", "win-3"])), "win-2");
    }

    #[test]
    fn main_is_reused_if_it_was_closed_but_others_remain() {
        assert_eq!(next_label(&v(&["win-2"])), "main");
    }

    #[test]
    fn closing_one_of_several_windows_keeps_the_engine() {
        assert!(!engine_should_stop(&v(&["main", "win-2"]), "win-2"));
        assert!(!engine_should_stop(&v(&["win-2"]), "main"));
    }

    #[test]
    fn closing_the_last_window_stops_the_engine_whether_or_not_it_is_still_listed() {
        assert!(engine_should_stop(&v(&["main"]), "main"));
        assert!(engine_should_stop(&[], "main"));
    }
}
