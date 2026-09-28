//! The native window's colour and appearance, kept in step with the web theme.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Appearance {
    Dark,
    Light,
    /// Follow the OS (the user picked the "System" theme).
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowTheme {
    pub background: (u8, u8, u8),
    pub appearance: Appearance,
}

/// Parses `#rrggbb`.
pub fn parse_hex(s: &str) -> Option<(u8, u8, u8)> {
    let hex = s.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some((byte(0)?, byte(2)?, byte(4)?))
}

pub fn parse_appearance(s: &str) -> Option<Appearance> {
    match s {
        "dark" => Some(Appearance::Dark),
        "light" => Some(Appearance::Light),
        "system" => Some(Appearance::System),
        _ => None,
    }
}

fn appearance_name(a: Appearance) -> &'static str {
    match a {
        Appearance::Dark => "dark",
        Appearance::Light => "light",
        Appearance::System => "system",
    }
}

pub fn from_args(background: &str, appearance: &str) -> Option<WindowTheme> {
    Some(WindowTheme { background: parse_hex(background)?, appearance: parse_appearance(appearance)? })
}

/// The theme saved by the last session, if any.
pub fn load(path: &Path) -> Option<WindowTheme> {
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    from_args(json.get("background")?.as_str()?, json.get("appearance")?.as_str()?)
}

pub fn save(path: &Path, theme: &WindowTheme) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let (r, g, b) = theme.background;
    let json = serde_json::json!({
        "background": format!("#{r:02x}{g:02x}{b:02x}"),
        "appearance": appearance_name(theme.appearance),
    });
    std::fs::write(path, json.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_six_digit_hex_only() {
        assert_eq!(parse_hex("#f2f2f7"), Some((0xf2, 0xf2, 0xf7)));
        assert_eq!(parse_hex("#161617"), Some((0x16, 0x16, 0x17)));
        assert_eq!(parse_hex("#FFF"), None);
        assert_eq!(parse_hex("161617"), None);
        assert_eq!(parse_hex("#16161g"), None);
        assert_eq!(parse_hex("#1616170"), None);
        assert_eq!(parse_hex("rgb(1,2,3)"), None);
    }

    #[test]
    fn parses_the_three_appearances() {
        assert_eq!(parse_appearance("dark"), Some(Appearance::Dark));
        assert_eq!(parse_appearance("light"), Some(Appearance::Light));
        assert_eq!(parse_appearance("system"), Some(Appearance::System));
        assert_eq!(parse_appearance("sepia"), None);
    }

    #[test]
    fn rejects_bad_arguments_from_the_page() {
        assert_eq!(
            from_args("#000000", "dark"),
            Some(WindowTheme { background: (0, 0, 0), appearance: Appearance::Dark })
        );
        assert_eq!(from_args("red", "dark"), None);
        assert_eq!(from_args("#000000", "blue"), None);
    }

    #[test]
    fn round_trips_through_its_file() {
        let dir = std::env::temp_dir().join(format!("kb-window-theme-{}", std::process::id()));
        let path = dir.join("nested").join("window-theme.json");
        let theme = WindowTheme { background: (0x28, 0x2a, 0x36), appearance: Appearance::System };
        save(&path, &theme).expect("save");
        assert_eq!(load(&path), Some(theme));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_corrupt_file_means_no_saved_theme() {
        let dir = std::env::temp_dir().join(format!("kb-window-theme-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(load(&dir.join("absent.json")), None);
        let bad = dir.join("bad.json");
        std::fs::write(&bad, "{\"background\":\"#zzzzzz\",\"appearance\":\"dark\"}").unwrap();
        assert_eq!(load(&bad), None);
        std::fs::write(&bad, "not json").unwrap();
        assert_eq!(load(&bad), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
