fn main() {
    // Declaring the app's commands turns on ACL checks for them: the page is
    // served by the engine over http://127.0.0.1, a remote origin to Tauri, and
    // may only call what capabilities/window-theme.json, smoke.json and
    // updates.json allow.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "set_window_theme",
            "smoke_ready",
            "update_status",
            "set_update_checks",
            "check_for_updates",
            "install_update",
        ]),
    ))
    .expect("failed to run tauri-build");
}
