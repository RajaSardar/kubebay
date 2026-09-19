import { useEffect, useState } from "react";
import type { ClusterIcon } from "../lib/useClusterIcons";

export { type ClusterIcon };

export const ICON_PRESETS: { bg: string; label: string }[] = [
  { bg: "#F90",     label: "AWS" },
  { bg: "#4285F4",  label: "GCP" },
  { bg: "#0078D4",  label: "AZ"  },
  { bg: "#7C3AED",  label: "K"   },
  { bg: "#326CE5",  label: "M"   },
  { bg: "#41c98e",  label: "DEV" },
  { bg: "#ef5f68",  label: "PRD" },
  { bg: "#64748b",  label: "STG" },
];

export function autoAvatar(id: string): ClusterIcon {
  if (id.startsWith("arn:aws")) return { bg: "#F90", label: "AWS" };
  if (id.includes("gke") || id.includes("gcp")) return { bg: "#4285F4", label: "GCP" };
  if (id.includes("aks") || id.includes("azure")) return { bg: "#0078D4", label: "AZ" };
  if (id.startsWith("kind-")) return { bg: "#7C3AED", label: "K" };
  if (id.startsWith("minikube")) return { bg: "#326CE5", label: "M" };
  return { bg: "var(--kb-accent)", label: id.slice(0, 2).toUpperCase() };
}

interface IconPickerProps {
  clusterId: string;
  current: ClusterIcon;
  onSave: (icon: ClusterIcon) => void;
  onReset: () => void;
  onClose: () => void;
}

export function ClusterIconPicker({ clusterId, current, onSave, onReset, onClose }: IconPickerProps) {
  const [bg, setBg] = useState(current.bg);
  const [label, setLabel] = useState(current.label);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="icon-picker-backdrop" onClick={onClose} />
      <div className="icon-picker">
        <div className="icon-picker-title">Customize icon</div>
        <div className="icon-picker-preview" style={{ background: bg }}>
          {label || "?"}
        </div>
        <div className="icon-picker-section">Colors</div>
        <div className="icon-picker-swatches">
          {ICON_PRESETS.map((p) => (
            <button
              key={p.bg}
              className={`icon-swatch${bg === p.bg ? " selected" : ""}`}
              style={{ background: p.bg }}
              onClick={() => { setBg(p.bg); setLabel(p.label); }}
              title={p.label}
            />
          ))}
          <label className="icon-swatch icon-swatch-custom" title="Custom color">
            <input
              type="color"
              value={bg.startsWith("#") ? bg : "#41c98e"}
              onChange={(e) => setBg(e.target.value)}
              style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }}
            />
            <span style={{ fontSize: "var(--kb-text-lg)" }}>🎨</span>
          </label>
        </div>
        <div className="icon-picker-section">Label</div>
        <input
          className="icon-picker-input"
          maxLength={3}
          value={label}
          onChange={(e) => setLabel(e.target.value.toUpperCase())}
          placeholder={clusterId.slice(0, 3).toUpperCase()}
          spellCheck={false}
        />
        <div className="icon-picker-actions">
          <button className="icon-picker-btn ghost" onClick={() => { onReset(); onClose(); }}>
            Reset
          </button>
          <button className="icon-picker-btn primary" onClick={() => { onSave({ bg, label }); onClose(); }}>
            Apply
          </button>
        </div>
      </div>
    </>
  );
}
