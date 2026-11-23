/**
 * Add sidecar (backlog 56, docs/ADD_SIDECAR.md): the form, its checks and the
 * strategic merge patch that appends one container to a workload's pod
 * template. Containers, init containers, volumes and volume mounts merge by
 * their keys, so the patch names only what it adds and nothing is replaced.
 */
import { parseServerMinor } from "./upgradeReadiness";

export type SidecarSlug = "deployments" | "statefulsets" | "daemonsets" | "cronjobs";

export const SIDECAR_GVR: Record<SidecarSlug, string> = {
  deployments: "apps/v1/deployments",
  statefulsets: "apps/v1/statefulsets",
  daemonsets: "apps/v1/daemonsets",
  cronjobs: "batch/v1/cronjobs",
};

export const SIDECAR_KIND: Record<SidecarSlug, string> = {
  deployments: "Deployment",
  statefulsets: "StatefulSet",
  daemonsets: "DaemonSet",
  cronjobs: "CronJob",
};

const API_VERSION: Record<SidecarSlug, string> = {
  deployments: "apps/v1",
  statefulsets: "apps/v1",
  daemonsets: "apps/v1",
  cronjobs: "batch/v1",
};

/** Kinds whose pod template takes a sidecar. Jobs are left out: a Job's template is immutable. */
export function sidecarSlug(slug: string): slug is SidecarSlug {
  return slug in SIDECAR_GVR;
}

export interface SidecarMount {
  volume: string;
  mountPath: string;
}

export interface SidecarEmptyDir {
  name: string;
  mountPath: string;
  /** Existing app containers that also mount it, at the same path. */
  shareWith: string[];
}

export interface SidecarForm {
  name: string;
  image: string;
  command: string;
  args: string;
  env: string;
  ports: string;
  cpuRequest: string;
  memoryRequest: string;
  cpuLimit: string;
  memoryLimit: string;
  mounts: SidecarMount[];
  emptyDir: SidecarEmptyDir | null;
  /** An init container with restartPolicy: Always (Kubernetes 1.29+), else a regular container. */
  native: boolean;
}

export type SidecarPresetId = "log-shipper" | "debug-toolbox" | "cloud-sql-proxy" | "custom";

export const SIDECAR_PRESETS: readonly { value: SidecarPresetId; label: string }[] = [
  { value: "log-shipper", label: "Log shipper" },
  { value: "debug-toolbox", label: "Debug toolbox" },
  { value: "cloud-sql-proxy", label: "Cloud SQL proxy" },
  { value: "custom", label: "Custom" },
];

export function emptySidecarForm(): SidecarForm {
  return {
    name: "",
    image: "",
    command: "",
    args: "",
    env: "",
    ports: "",
    cpuRequest: "",
    memoryRequest: "",
    cpuLimit: "",
    memoryLimit: "",
    mounts: [],
    emptyDir: null,
    native: false,
  };
}

/** A preset fills the form; every field stays editable. */
export function presetForm(id: SidecarPresetId, apps: string[], nativeSupported: boolean): SidecarForm {
  const base = { ...emptySidecarForm(), native: nativeSupported };
  const small = { cpuRequest: "10m", memoryRequest: "16Mi" };
  switch (id) {
    case "log-shipper":
      return {
        ...base,
        ...small,
        name: "log-shipper",
        image: "busybox:1.36",
        command: "sh -c",
        args: `'tail -n+1 -F /var/log/app/*.log'`,
        emptyDir: { name: "shared-logs", mountPath: "/var/log/app", shareWith: [...apps] },
      };
    case "debug-toolbox":
      return { ...base, ...small, name: "debug-toolbox", image: "nicolaka/netshoot:latest", command: "sleep infinity" };
    case "cloud-sql-proxy":
      return {
        ...base,
        cpuRequest: "50m",
        memoryRequest: "64Mi",
        name: "cloud-sql-proxy",
        image: "gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.1",
        args: "--port=5432 PROJECT:REGION:INSTANCE",
        ports: "5432",
      };
    default:
      return base;
  }
}

/** Splits like a shell: whitespace separates words, single or double quotes group them. Null on an unclosed quote. */
export function splitWords(s: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) out.push(cur);
      cur = "";
      inWord = false;
    } else {
      cur += ch;
      inWord = true;
    }
  }
  if (quote) return null;
  if (inWord) out.push(cur);
  return out;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function names(v: unknown): string[] {
  return list(v)
    .map((c) => c.name)
    .filter((n): n is string => typeof n === "string");
}

/** The pod spec the sidecar goes into: spec.template.spec, or a CronJob's job template. */
export function podTemplateSpec(slug: SidecarSlug, obj: Record<string, unknown>): Record<string, unknown> {
  const spec = rec(obj.spec);
  const holder = slug === "cronjobs" ? rec(rec(spec.jobTemplate).spec) : spec;
  return rec(rec(holder.template).spec);
}

export function appContainers(pod: Record<string, unknown>): string[] {
  return names(pod.containers);
}

export function podVolumes(pod: Record<string, unknown>): string[] {
  return names(pod.volumes);
}

/** Native sidecars (an init container with restartPolicy: Always) are on by default from Kubernetes 1.29. */
export function nativeSidecarSupported(version: string | undefined): boolean {
  if (!version) return false;
  const m = /^v?(\d+)\./.exec(version.trim());
  if (!m) return false;
  const major = Number(m[1]);
  if (major > 1) return true;
  const minor = parseServerMinor(version);
  return major === 1 && minor !== undefined && minor >= 29;
}

const PORT = /^(\d+)(?:\/(TCP|UDP|SCTP))?$/i;

function portWords(s: string): string[] {
  return s.split(/[\s,]+/).filter(Boolean);
}

function envPairs(words: string[]): { name: string; value: string }[] {
  return words.map((w) => {
    const i = w.indexOf("=");
    return { name: w.slice(0, i), value: w.slice(i + 1) };
  });
}

/** The container the form describes; empty fields are left out. */
export function buildSidecarContainer(form: SidecarForm): Record<string, unknown> {
  const c: Record<string, unknown> = { name: form.name.trim(), image: form.image.trim() };
  const command = splitWords(form.command) ?? [];
  const args = splitWords(form.args) ?? [];
  const env = splitWords(form.env) ?? [];
  if (command.length) c.command = command;
  if (args.length) c.args = args;
  if (env.length) c.env = envPairs(env);
  const ports = portWords(form.ports).map((w) => {
    const m = PORT.exec(w);
    return { containerPort: Number(m?.[1] ?? w), protocol: (m?.[2] ?? "TCP").toUpperCase() };
  });
  if (ports.length) c.ports = ports;
  const requests: Record<string, string> = {};
  const limits: Record<string, string> = {};
  if (form.cpuRequest.trim()) requests.cpu = form.cpuRequest.trim();
  if (form.memoryRequest.trim()) requests.memory = form.memoryRequest.trim();
  if (form.cpuLimit.trim()) limits.cpu = form.cpuLimit.trim();
  if (form.memoryLimit.trim()) limits.memory = form.memoryLimit.trim();
  if (Object.keys(requests).length || Object.keys(limits).length) {
    c.resources = { ...(Object.keys(requests).length ? { requests } : {}), ...(Object.keys(limits).length ? { limits } : {}) };
  }
  const mounts = form.mounts.map((m) => ({ name: m.volume, mountPath: m.mountPath.trim() }));
  if (form.emptyDir) mounts.push({ name: form.emptyDir.name.trim(), mountPath: form.emptyDir.mountPath.trim() });
  if (mounts.length) c.volumeMounts = mounts;
  if (form.native) c.restartPolicy = "Always";
  return c;
}

const OWNER_ANNOTATIONS = [
  "argocd.argoproj.io/instance",
  "argocd.argoproj.io/tracking-id",
  "kustomize.toolkit.fluxcd.io/name",
  "helm.toolkit.fluxcd.io/name",
];

/**
 * The strategic merge patch that appends the sidecar. Identity and the GitOps
 * owner annotation ride in metadata (the engine drops metadata from a
 * strategic patch and reads the owner for its audit entry); the spec names
 * only the new container, its new volume and the new mounts.
 */
export function buildSidecarPatch(slug: SidecarSlug, obj: Record<string, unknown>, form: SidecarForm): Record<string, unknown> {
  const meta = rec(obj.metadata);
  const annotations = rec(meta.annotations);
  const owner: Record<string, string> = {};
  for (const k of OWNER_ANNOTATIONS) if (typeof annotations[k] === "string") owner[k] = annotations[k] as string;

  const container = buildSidecarContainer(form);
  const pod: Record<string, unknown> = {};
  const containers: Record<string, unknown>[] = [];
  if (form.native) pod.initContainers = [container];
  else containers.push(container);
  if (form.emptyDir) {
    const mount = { name: form.emptyDir.name.trim(), mountPath: form.emptyDir.mountPath.trim() };
    for (const app of form.emptyDir.shareWith) containers.push({ name: app, volumeMounts: [mount] });
    pod.volumes = [{ name: mount.name, emptyDir: {} }];
  }
  if (containers.length) pod.containers = containers;
  // Key order: containers, initContainers, volumes, so the preview reads top-down.
  const ordered: Record<string, unknown> = {};
  for (const k of ["containers", "initContainers", "volumes"]) if (pod[k]) ordered[k] = pod[k];

  const template = { template: { spec: ordered } };
  return {
    apiVersion: API_VERSION[slug],
    kind: SIDECAR_KIND[slug],
    metadata: {
      name: meta.name,
      namespace: meta.namespace,
      ...(Object.keys(owner).length ? { annotations: owner } : {}),
    },
    spec: slug === "cronjobs" ? { jobTemplate: { spec: template } } : template,
  };
}

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const ENV_NAME = /^[-._a-zA-Z][-._a-zA-Z0-9]*$/;
const QUANTITY = /^\d+(\.\d+)?(m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/;

/** Everything wrong with the form, as sentences; empty when it can be previewed. */
export function validateSidecar(slug: SidecarSlug, obj: Record<string, unknown>, form: SidecarForm, nativeSupported: boolean): string[] {
  const errs: string[] = [];
  const pod = podTemplateSpec(slug, obj);
  const name = form.name.trim();
  if (!name) errs.push("Name is required.");
  else if (name.length > 63 || !DNS_LABEL.test(name)) errs.push("Name must be a DNS label: lower-case letters, digits and -, up to 63 characters.");
  const taken = [...names(pod.containers), ...names(pod.initContainers), ...names(pod.ephemeralContainers)];
  if (name && taken.includes(name)) errs.push(`A container named "${name}" already exists in this pod template.`);
  if (!form.image.trim()) errs.push("Image is required.");

  for (const [label, text] of [
    ["Command", form.command],
    ["Args", form.args],
    ["Env", form.env],
  ] as const) {
    if (splitWords(text) === null) errs.push(`${label} has an unclosed quote.`);
  }
  for (const w of splitWords(form.env) ?? []) {
    const i = w.indexOf("=");
    if (i <= 0 || !ENV_NAME.test(w.slice(0, i))) errs.push(`Env "${w}" is not KEY=value.`);
  }
  for (const w of portWords(form.ports)) {
    const m = PORT.exec(w);
    const n = m ? Number(m[1]) : NaN;
    if (!m || n < 1 || n > 65535) errs.push(`Port "${w}" is not a number from 1 to 65535 with an optional /TCP, /UDP or /SCTP.`);
  }
  for (const [label, q] of [
    ["CPU request", form.cpuRequest],
    ["Memory request", form.memoryRequest],
    ["CPU limit", form.cpuLimit],
    ["Memory limit", form.memoryLimit],
  ] as const) {
    if (q.trim() && !QUANTITY.test(q.trim())) errs.push(`${label} "${q.trim()}" is not a quantity.`);
  }

  const volumes = podVolumes(pod);
  const paths: string[] = [];
  const checkPath = (p: string) => {
    if (!p.startsWith("/")) errs.push(`Mount path "${p}" must be absolute.`);
    else if (paths.includes(p)) errs.push(`"${p}" is mounted twice.`);
    paths.push(p);
  };
  for (const m of form.mounts) {
    if (!volumes.includes(m.volume)) errs.push(`Volume "${m.volume}" is not in this pod template.`);
    checkPath(m.mountPath.trim());
  }
  if (form.emptyDir) {
    const v = form.emptyDir.name.trim();
    const p = form.emptyDir.mountPath.trim();
    if (!v || v.length > 63 || !DNS_LABEL.test(v)) errs.push("The new volume's name must be a DNS label.");
    else if (volumes.includes(v)) errs.push(`A volume named "${v}" already exists.`);
    checkPath(p);
    for (const app of form.emptyDir.shareWith) {
      const c = list(pod.containers).find((x) => x.name === app);
      if (!c) continue;
      if (list(c.volumeMounts).some((vm) => vm.mountPath === p)) errs.push(`Container "${app}" already mounts something at ${p}.`);
    }
  }

  if (form.native && !nativeSupported) errs.push("Native sidecars need Kubernetes 1.29 or newer.");
  if (slug === "cronjobs" && !form.native) {
    errs.push("A CronJob takes only a native sidecar: a regular container that never exits keeps every Job running.");
  }
  return errs;
}
