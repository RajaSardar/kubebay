interface IconProps {
  size?: number;
  strokeWidth?: number;
}

function base(size: number | undefined, strokeWidth: number | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeWidth ?? 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

// ── Workloads — container/package (VSCode-style box with lid) ────────────────
export function IconCube({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" />
    </svg>
  );
}

// ── Custom Resources — puzzle/extension piece (VSCode extensions icon) ────────
export function IconGrid({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M20.5 7.5h-3V5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v2.5h-3A1.5 1.5 0 0 0 2 9v11a1.5 1.5 0 0 0 1.5 1.5h17A1.5 1.5 0 0 0 22 20V9a1.5 1.5 0 0 0-1.5-1.5zm-10.5 0V5h4v2.5h-4z" />
    </svg>
  );
}

// ── Topology — three nodes graph ─────────────────────────────────────────────
export function IconTopology({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="4.5" cy="19.5" r="2" />
      <circle cx="19.5" cy="19.5" r="2" />
      <path d="M12 6.5V10M12 10l-5.5 7.7M12 10l5.5 7.7M6.5 19.5h11" />
    </svg>
  );
}

// ── Timeline — activity pulse (used in Timeline page) ────────────────────────
export function IconTimeline({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <polyline points="2 12 6 12 8.5 5 11.5 19 14 12 16 12" />
      <path d="M16 12h6" />
    </svg>
  );
}

// ── Shield — access control / RBAC ───────────────────────────────────────────
export function IconShield({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

// ── Helm — ship's wheel ───────────────────────────────────────────────────────
export function IconHelm({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <line x1="12" y1="3" x2="12" y2="9.5" />
      <line x1="12" y1="14.5" x2="12" y2="21" />
      <line x1="3" y1="12" x2="9.5" y2="12" />
      <line x1="14.5" y1="12" x2="21" y2="12" />
      <line x1="5.64" y1="5.64" x2="9.7" y2="9.7" />
      <line x1="14.3" y1="14.3" x2="18.36" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="14.3" y2="9.7" />
      <line x1="9.7" y1="14.3" x2="5.64" y2="18.36" />
    </svg>
  );
}

// ── Settings/Config — gear ────────────────────────────────────────────────────
export function IconSliders({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Search — magnifying glass ─────────────────────────────────────────────────
export function IconSearch({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

// ── Refresh ───────────────────────────────────────────────────────────────────
export function IconRefresh({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

// ── Alert / Warning ───────────────────────────────────────────────────────────
export function IconAlert({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

// ── Port Forward — arrow out of box ──────────────────────────────────────────
export function IconForward({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

// ── Network — connected nodes / cloud ────────────────────────────────────────
export function IconNetwork({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <rect x="2" y="18" width="6" height="4" rx="1" />
      <rect x="16" y="18" width="6" height="4" rx="1" />
      <path d="M12 6v4M5 18v-4h14v4M12 10h-7v4M12 10h7v4" />
    </svg>
  );
}

// ── Storage — disk stack ──────────────────────────────────────────────────────
export function IconDatabase({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v4c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 13v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4" />
      <path d="M4 9c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  );
}

// ── Layers — stacked layers (kept for Fleet/Layers usage) ────────────────────
export function IconLayers({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

// ── ArgoCD — GitOps sync icon (two circular arrows forming a loop) ────────────
export function IconArgoCD({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M12 2a10 10 0 0 1 7.39 16.74" />
      <path d="M12 2v4" />
      <path d="m9 5 3-3 3 3" />
      <path d="M12 22a10 10 0 0 1-7.39-16.74" />
      <path d="M12 22v-4" />
      <path d="m15 19-3 3-3-3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ── Home — house ──────────────────────────────────────────────────────────────
export function IconHome({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
