// KB-02: the comparison table's data. Every cell names its source and the
// day it was checked; comparison.test.ts fails the build on a cell without
// one. Performance figures (RAM, start-up time, installer size) stay out
// until Kubebay's harness measures every tool the same way.

export interface Source {
  url: string;
  /** The day someone read the source and confirmed the cell (YYYY-MM-DD). */
  checked: string;
  /** What in the source supports the cell, when it isn't obvious. */
  note?: string;
}

export type CellKind = "yes" | "no" | "partial" | "text";

export interface Cell {
  kind: CellKind;
  label?: string;
  source: Source;
}

export const COLUMNS = ["kubebay", "lens", "freelens", "k9s", "headlamp"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_NAMES: Record<Column, string> = {
  kubebay: "Kubebay",
  lens: "Lens",
  freelens: "Freelens",
  k9s: "k9s",
  headlamp: "Headlamp",
};

export type Row = { feature: string } & Record<Column, Cell>;

const CHECKED = "2026-10-13";

const kubebay = {
  license: { url: "https://github.com/RajaSardar/kubebay/blob/main/LICENSE", checked: CHECKED },
  prd: {
    url: "https://github.com/RajaSardar/kubebay/blob/main/docs/PRODUCT_REQUIREMENTS.md",
    checked: CHECKED,
    note: "No paywall on any single-user feature, ever. Sponsorships fund the project.",
  },
  readme: { url: "https://github.com/RajaSardar/kubebay#readme", checked: CHECKED, note: "Local-first. No accounts." },
  release: {
    url: "https://github.com/RajaSardar/kubebay/releases/tag/v0.6.0",
    checked: CHECKED,
    note: "macOS .dmg, Windows .exe, Linux .deb and .AppImage",
  },
};

const lens = {
  pricing: {
    url: "https://lenshq.io/pricing/",
    checked: CHECKED,
    note: "Personal is free for individuals and companies under $10M in revenue or funding; Plus, Pro and Enterprise are paid.",
  },
  licensing: {
    url: "https://docs.k8slens.dev/faq/subscription-and-licensing/",
    checked: CHECKED,
    note: "Lens Desktop is used under a subscription licence and signs in with a Lens ID on every plan, the free one included.",
  },
  product: { url: "https://lenshq.io/products/lens-k8s-ide/", checked: CHECKED },
};

const freelens = {
  license: { url: "https://github.com/freelensapp/freelens/blob/main/LICENSE", checked: CHECKED },
  readme: {
    url: "https://github.com/freelensapp/freelens#readme",
    checked: CHECKED,
    note: "A free and open-source, standalone application for macOS, Windows and Linux.",
  },
  noSignIn: {
    url: "https://alexandre-vazquez.com/freelens-vs-openlens-vs-lens-kubernetes-ide/",
    checked: CHECKED,
    note: "Freelens is Lens without the Lens ID sign-in.",
  },
};

const k9s = {
  license: { url: "https://github.com/derailed/k9s/blob/master/LICENSE", checked: CHECKED },
  readme: {
    url: "https://github.com/derailed/k9s#readme",
    checked: CHECKED,
    note: "A terminal UI, installed as a binary that reads your kubeconfig. \"K9s will always remain OSS and therefore free!\"",
  },
};

const headlamp = {
  license: { url: "https://github.com/kubernetes-sigs/headlamp/blob/main/LICENSE", checked: CHECKED },
  readme: {
    url: "https://github.com/kubernetes-sigs/headlamp#readme",
    checked: CHECKED,
    note: "Works in-cluster, or locally as a desktop app for Linux, Mac or Windows.",
  },
};

export const rows: Row[] = [
  {
    feature: "License",
    kubebay: { kind: "text", label: "MIT", source: kubebay.license },
    lens: { kind: "text", label: "Proprietary", source: lens.licensing },
    freelens: { kind: "text", label: "MIT", source: freelens.license },
    k9s: { kind: "text", label: "Apache 2.0", source: k9s.license },
    headlamp: { kind: "text", label: "Apache 2.0", source: headlamp.license },
  },
  {
    feature: "Price",
    kubebay: { kind: "yes", label: "Free, no paid tier", source: kubebay.prd },
    lens: { kind: "partial", label: "Free under $10M revenue or funding; paid tiers above", source: lens.pricing },
    freelens: { kind: "yes", label: "Free", source: freelens.readme },
    k9s: { kind: "yes", label: "Free", source: k9s.readme },
    headlamp: { kind: "yes", label: "Free", source: headlamp.license },
  },
  {
    feature: "Account to sign in",
    kubebay: { kind: "yes", label: "None", source: kubebay.readme },
    lens: { kind: "no", label: "Lens ID, free plan included", source: lens.licensing },
    freelens: { kind: "yes", label: "None", source: freelens.noSignIn },
    k9s: { kind: "yes", label: "None", source: k9s.readme },
    headlamp: { kind: "yes", label: "None", source: headlamp.readme },
  },
  {
    feature: "Desktop app",
    kubebay: { kind: "yes", label: "macOS / Windows / Linux", source: kubebay.release },
    lens: { kind: "yes", label: "macOS / Windows / Linux", source: lens.product },
    freelens: { kind: "yes", label: "macOS / Windows / Linux", source: freelens.readme },
    k9s: { kind: "partial", label: "Terminal UI", source: k9s.readme },
    headlamp: { kind: "yes", label: "macOS / Windows / Linux", source: headlamp.readme },
  },
];
