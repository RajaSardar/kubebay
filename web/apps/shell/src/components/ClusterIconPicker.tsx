import { useRef, useState } from "react";
import { Button, Modal, Tabs } from "@kubebay/ui";
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
    <Modal label="Customize icon" onClose={onClose} backdrop="clear" className="icon-picker">
        <div className="icon-picker-title">Customize icon</div>

        {/* Preview */}
        <div className="icon-picker-preview" style={{ background: previewImageUrl ? "transparent" : bg, color: avatarLabelColor(bg) }}>
          {previewImageUrl
            ? <img src={previewImageUrl} alt="icon preview" className="icon-picker-preview-img" onError={() => setImgError(true)} />
            : (label || "?")}
        </div>

        {/* Tabs */}
        <Tabs
          tabs={["color", "image"] as const}
          active={tab}
          labels={{ color: "Color", image: "Image" }}
          onChange={setTab}
          className="tabs icon-picker-tabs"
        />

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
            <button type="button" className="icon-picker-upload-btn" onClick={() => fileInputRef.current?.click()}>
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
          <Button variant="ghost" onClick={() => { onReset(); onClose(); }}>
            Reset
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </div>
    </Modal>
  );
}

/** Label colour for initials on a user-picked avatar colour: white or near-black, whichever contrasts more. */
export function avatarLabelColor(bg: string): string {
  const v = bg.trim();
  // The theme accent (the fallback avatar) has its own on-colour token.
  if (v === "var(--kb-accent)") return "var(--kb-accent-fg)";
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  const hex = short ? `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : /^#([0-9a-f]{6})$/i.exec(v)?.[1];
  if (!hex) return "#ffffff";
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (0.0056 + 0.05); // #111111
  return onWhite >= onDark ? "#ffffff" : "#111111";
}

/**
 * How a cluster avatar in the strip shows its state. Clickable avatars stay at
 * full opacity (fading them took their labels below 1.5:1); inactive ones are
 * desaturated instead, which keeps the label's contrast. A broken cluster is a
 * disabled button and may fade.
 */
export function stripAvatarLook({ broken, active, streaming }: { broken?: boolean; active?: boolean; streaming?: boolean }): {
  opacity: number;
  filter: string;
} {
  if (broken) return { opacity: 0.22, filter: "grayscale(1)" };
  if (active) return { opacity: 1, filter: "none" };
  return { opacity: 1, filter: streaming ? "saturate(0.6)" : "saturate(0.2)" };
}
