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

export function IconGrid({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconCube({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3.3 7.3 12 12l8.7-4.7M12 22V12" />
    </svg>
  );
}

export function IconTopology({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="12" cy="5" r="2.6" />
      <circle cx="5.5" cy="18.5" r="2.6" />
      <circle cx="18.5" cy="18.5" r="2.6" />
      <path d="M10.7 7.2 6.8 16.3M13.3 7.2l3.9 9.1M8.1 18.5h7.8" />
    </svg>
  );
}

export function IconTimeline({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />
    </svg>
  );
}

export function IconShield({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
    </svg>
  );
}

export function IconHelm({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2" />
    </svg>
  );
}

export function IconSliders({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

export function IconSearch({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function IconRefresh({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function IconAlert({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function IconForward({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="M20 8H6l3-3M6 8l3 3" />
      <path d="M4 16h14l-3-3M18 16l-3 3" />
    </svg>
  );
}

export function IconNetwork({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.9 5.6 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.6-3.9-9S9.5 5.6 12 3z" />
    </svg>
  );
}

export function IconDatabase({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  );
}

export function IconLayers({ size, strokeWidth }: IconProps) {
  return (
    <svg {...base(size, strokeWidth)}>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}
