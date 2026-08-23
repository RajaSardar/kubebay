import { Button } from "@kubebay/ui";
import { useTheme, type ThemeName } from "../lib/theme";

const THEMES: { id: ThemeName; label: string; hint: string; swatch: [string, string, string] }[] = [
  { id: "dusk", label: "Dusk", hint: "Dark · default", swatch: ["#0a0b10", "#171a24", "#5b8def"] },
  { id: "dawn", label: "Dawn", hint: "Light", swatch: ["#f7f8fb", "#ffffff", "#3067d6"] },
  { id: "system", label: "System", hint: "Follows OS", swatch: ["#101218", "#f7f8fb", "#5b8def"] },
  { id: "dusk-hc", label: "Dusk HC", hint: "High contrast dark", swatch: ["#000000", "#161616", "#7cabff"] },
  { id: "dawn-hc", label: "Dawn HC", hint: "High contrast light", swatch: ["#ffffff", "#f0f0f0", "#003fb3"] },
];

export default function Settings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="page">
      <div className="page-header">
        <h2>Appearance</h2>
      </div>

      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={theme === t.id ? "theme-card active" : "theme-card"}
            onClick={() => setTheme(t.id)}
          >
            <span
              className="swatch"
              style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 45%, ${t.swatch[1]} 55%)` }}
              ref={(el) => {
                if (!el) return;
                el.style.setProperty("--dot", t.swatch[2]);
              }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <strong style={{ fontWeight: 600 }}>{t.label}</strong>
              <span className="muted small">{t.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="subtle small" style={{ marginBottom: 14 }}>
        Themes are token-driven — plugins inherit them read-only. Switching is flicker-free and persisted locally.
      </p>

      <Button variant="ghost" onClick={() => setTheme("system")}>
        Reset to system
      </Button>
    </div>
  );
}
