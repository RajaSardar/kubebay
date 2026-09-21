import { useEffect, useRef, useState } from "react";
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
  const s = id.toLowerCase();
  if (s.startsWith("arn:aws") || s.startsWith("arn-aws")) return { bg: "#F90", label: "AWS" };
  if (s.includes("gke") || s.includes("gcp")) return { bg: "#4285F4", label: "GCP" };
  if (s.includes("aks") || s.includes("azure")) return { bg: "#0078D4", label: "AZ" };
  if (s.startsWith("kind-") || s === "kind") return { bg: "#7C3AED", label: "K" };
  if (s.startsWith("minikube") || s === "minikube") return { bg: "#326CE5", label: "M" };
  if (s === "orbstack" || s.startsWith("orbstack-")) return { bg: "#22d3ee", label: "ORB" };
  return { bg: "var(--kb-accent)", label: id.slice(0, 2).toUpperCase() };
}

interface IconPickerProps {
  clusterId: string;
  current: ClusterIcon;
  onSave: (icon: ClusterIcon) => void;
  onReset: () => void;
  onClose: () => void;
}

type Tab = "color" | "image";

export function ClusterIconPicker({ clusterId, current, onSave, onReset, onClose }: IconPickerProps) {
  const [tab, setTab] = useState<Tab>(current.imageUrl ? "image" : "color");
  const [bg, setBg] = useState(current.bg);
  const [label, setLabel] = useState(current.label);
  const [imageUrl, setImageUrl] = useState(current.imageUrl ?? "");
  const [imgError, setImgError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setImageUrl(result);
      setImgError(false);
    };
    reader.readAsDataURL(file);
  }

  function handleApply() {
    if (tab === "image" && imageUrl) {
      onSave({ bg, label, imageUrl });
    } else {
      onSave({ bg, label });
    }
    onClose();
  }

  const previewImageUrl = tab === "image" && imageUrl && !imgError ? imageUrl : null;

  return (
    <>
      <div className="icon-picker-backdrop" onClick={onClose} />
      <div className="icon-picker">
        <div className="icon-picker-title">Customize icon</div>

        {/* Preview */}
        <div className="icon-picker-preview" style={{ background: previewImageUrl ? "transparent" : bg }}>
          {previewImageUrl
            ? <img src={previewImageUrl} alt="icon preview" className="icon-picker-preview-img" onError={() => setImgError(true)} />
            : (label || "?")}
        </div>

        {/* Tabs */}
        <div className="icon-picker-tabs">
          <button
            role="tab"
            aria-selected={tab === "color"}
            className={`icon-picker-tab${tab === "color" ? " active" : ""}`}
            onClick={() => setTab("color")}
          >
            Color
          </button>
          <button
            role="tab"
            aria-selected={tab === "image"}
            className={`icon-picker-tab${tab === "image" ? " active" : ""}`}
            onClick={() => setTab("image")}
          >
            Image
          </button>
        </div>

        {tab === "color" && (
          <>
            <div className="icon-picker-section">Color</div>
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
          </>
        )}

        {tab === "image" && (
          <>
            <div className="icon-picker-section">Image URL</div>
            <input
              className="icon-picker-input"
              type="url"
              placeholder="https://..."
              value={imageUrl.startsWith("data:") ? "" : imageUrl}
              onChange={(e) => { setImageUrl(e.target.value); setImgError(false); }}
              spellCheck={false}
            />
            {imgError && <p className="icon-picker-error">Could not load image</p>}

            <div className="icon-picker-section">Or upload a file</div>
            <button
              className="icon-picker-btn ghost icon-picker-upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              {imageUrl.startsWith("data:") ? "✓ File loaded — click to change" : "Choose file…"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <p className="icon-picker-hint">PNG, JPG, SVG or GIF · stored locally</p>
          </>
        )}

        <div className="icon-picker-actions">
          <button className="icon-picker-btn ghost" onClick={() => { onReset(); onClose(); }}>
            Reset
          </button>
          <button role="button" aria-label="Apply" className="icon-picker-btn primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </>
  );
}
