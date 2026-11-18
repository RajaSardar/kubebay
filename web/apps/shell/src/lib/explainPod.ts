// "Explain this pod": a deterministic rule engine, no LLM and no network. It reads only the pod object
// and the events already streamed for it, names the first known cause that matches, cites the field it
// read, and offers up to three next steps. Anything it cannot match is reported as "no known cause"
// rather than guessed.

export type ExplainCause =
  | "evicted"
  | "node-not-ready"
  | "oom-killed"
  | "image-pull"
  | "container-config"
  | "crash-loop"
  | "pvc-unbound"
  | "unschedulable"
  | "probe-failing"
  | "exited"
  | "unknown";

export type ExplainAction =
  | { kind: "logs"; container: string; previous: boolean }
  | { kind: "events" }
  | { kind: "yaml" }
  | { kind: "resource"; resource: string; ns: string; name: string };

export interface ExplainStep {
  label: string;
  action: ExplainAction;
}

export interface PodExplanation {
  cause: ExplainCause;
  diagnosis: string;
  /** The field(s) the diagnosis was read from, so the card is checkable. */
  cites: string;
  steps: ExplainStep[];
}

export interface PodEvent {
  type?: string;
  reason?: string;
  message?: string;
}

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function clip(t: string, n = 300): string {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

const IMAGE_PULL = new Set(["ImagePullBackOff", "ErrImagePull", "InvalidImageName", "ImageInspectError", "ErrImageNeverPull"]);
const CONFIG_ERR = new Set(["CreateContainerConfigError", "CreateContainerError"]);
const STARTING = new Set(["ContainerCreating", "PodInitializing"]);

interface CStatus {
  name: string;
  init: boolean;
  ready: boolean;
  restarts: number;
  waiting: Obj | null;
  terminated: Obj | null;
  lastTerminated: Obj | null;
  field: string;
}

function statuses(status: Obj): CStatus[] {
  const out: CStatus[] = [];
  for (const [key, init] of [["initContainerStatuses", true], ["containerStatuses", false]] as const) {
    for (const c of arr(status[key])) {
      const st = rec(c.state);
      const last = rec(rec(c.lastState).terminated);
      out.push({
        name: s(c.name),
        init,
        ready: c.ready === true,
        restarts: Number(c.restartCount ?? 0),
        waiting: st.waiting ? rec(st.waiting) : null,
        terminated: st.terminated ? rec(st.terminated) : null,
        lastTerminated: Object.keys(last).length ? last : null,
        field: `status.${key}[${s(c.name)}]`,
      });
    }
  }
  return out;
}

function specContainer(spec: Obj, name: string): Obj {
  return [...arr(spec.containers), ...arr(spec.initContainers)].find((c) => c.name === name) ?? {};
}

const evStep = (): ExplainStep => ({ label: "Read the pod's events", action: { kind: "events" } });
const yamlStep = (label: string): ExplainStep => ({ label, action: { kind: "yaml" } });

export function explainPod(obj: Obj, events: PodEvent[]): PodExplanation | null {
  const meta = rec(obj.metadata);
  const spec = rec(obj.spec);
  const status = rec(obj.status);
  const phase = s(status.phase);
  if (!phase || phase === "Succeeded") return null;

  const ns = s(meta.namespace);
  const nodeName = s(spec.nodeName);
  const conds = arr(status.conditions);
  const readyCond = conds.find((c) => c.type === "Ready");
  const cs = statuses(status);
  const main = cs.filter((c) => !c.init);

  const unhealthy =
    phase === "Failed" ||
    phase === "Pending" ||
    (readyCond ? readyCond.status !== "True" : main.some((c) => !c.ready));
  if (!unhealthy) return null;

  const nodeStep = (): ExplainStep[] =>
    nodeName ? [{ label: `Check node ${nodeName}`, action: { kind: "resource", resource: "nodes", ns: "", name: nodeName } }] : [];
  const finish = (cause: ExplainCause, diagnosis: string, cites: string, steps: ExplainStep[]): PodExplanation => ({
    cause,
    diagnosis,
    cites,
    steps: steps.slice(0, 3),
  });

  // Evicted
  if (s(status.reason) === "Evicted") {
    const msg = s(status.message);
    return finish("evicted", `The kubelet evicted this pod${msg ? `: ${clip(msg)}` : "."}`, "status.reason, status.message", [
      ...nodeStep(),
      evStep(),
      yamlStep("Check the pod's resource requests in YAML"),
    ]);
  }

  // Node lost or not ready
  const nodeEvent = events.find((e) => e.reason === "NodeNotReady");
  if (s(status.reason) === "NodeLost" || nodeEvent) {
    const fromReason = s(status.reason) === "NodeLost";
    return finish(
      "node-not-ready",
      `The node${nodeName ? ` ${nodeName}` : ""} is likely not ready, so this pod cannot be reported as healthy${fromReason && s(status.message) ? `: ${clip(s(status.message))}` : "."}`,
      fromReason ? "status.reason" : "event NodeNotReady",
      [...nodeStep(), evStep()],
    );
  }

  // OOMKilled: current or previous termination
  for (const c of cs) {
    const t = c.terminated && s(c.terminated.reason) === "OOMKilled" ? c.terminated : c.lastTerminated && s(c.lastTerminated.reason) === "OOMKilled" ? c.lastTerminated : null;
    if (!t) continue;
    const limit = s(rec(rec(specContainer(spec, c.name).resources).limits).memory);
    const code = typeof t.exitCode === "number" ? ` (exit code ${t.exitCode})` : "";
    const lim = limit ? `its memory limit is ${limit}, so it likely used more than that` : "it has no memory limit, so the node itself likely ran out of memory";
    return finish(
      "oom-killed",
      `Container "${c.name}" was OOMKilled${code}: ${lim}.`,
      `${c.field}.${c.terminated === t ? "state" : "lastState"}.terminated.reason, spec memory limit`,
      [
        yamlStep(limit ? "Review the memory limit in YAML" : "Set a memory limit in YAML"),
        { label: "Read the previous container's logs", action: { kind: "logs", container: c.name, previous: true } },
        evStep(),
      ],
    );
  }

  // Image pull
  for (const c of cs) {
    const r = s(c.waiting?.reason);
    if (!IMAGE_PULL.has(r)) continue;
    const image = s(specContainer(spec, c.name).image);
    const msg = s(c.waiting?.message);
    return finish(
      "image-pull",
      `Container "${c.name}" cannot start: ${r}${image ? ` for image ${image}` : ""}${msg ? `. Kubelet says: ${clip(msg)}` : "."} The image name, tag or registry credentials are likely wrong.`,
      `${c.field}.state.waiting.reason`,
      [evStep(), yamlStep("Check the image and imagePullSecrets in YAML")],
    );
  }

  // Container config error
  for (const c of cs) {
    const r = s(c.waiting?.reason);
    if (!CONFIG_ERR.has(r)) continue;
    const msg = s(c.waiting?.message);
    return finish(
      "container-config",
      `Container "${c.name}" could not be created: ${r}${msg ? `. Kubelet says: ${clip(msg)}` : "."}`,
      `${c.field}.state.waiting`,
      [evStep(), yamlStep("Check env, volumes and the referenced ConfigMap or Secret in YAML")],
    );
  }

  // Crash loop
  for (const c of cs) {
    if (s(c.waiting?.reason) !== "CrashLoopBackOff") continue;
    const code = c.lastTerminated && typeof c.lastTerminated.exitCode === "number" ? c.lastTerminated.exitCode : null;
    return finish(
      "crash-loop",
      `Container "${c.name}" keeps crashing and is being restarted${c.restarts ? ` (${c.restarts} restarts)` : ""}${code !== null ? `; the last run ended with exit code ${code}` : ""}. The reason is usually in its logs.`,
      `${c.field}.state.waiting.reason, lastState.terminated.exitCode`,
      [{ label: "Read the previous container's logs", action: { kind: "logs", container: c.name, previous: true } }, evStep()],
    );
  }

  // Scheduling: PVC first, then generic
  const sched = conds.find((c) => c.type === "PodScheduled" && c.status === "False");
  if (sched) {
    const msg = s(sched.message);
    const claims = arr(spec.volumes).map((v) => s(rec(v.persistentVolumeClaim).claimName)).filter(Boolean);
    const named = /persistentvolumeclaim "([^"]+)" not found/i.exec(msg)?.[1];
    const unbound = /unbound immediate persistentvolumeclaims|unbound.*persistentvolumeclaim/i.test(msg);
    if (named || unbound) {
      const claim = named ?? (claims.length === 1 ? claims[0] : "");
      const steps: ExplainStep[] = [];
      if (claim) steps.push({ label: `Open PVC ${claim}`, action: { kind: "resource", resource: "persistentvolumeclaims", ns, name: claim } });
      steps.push(evStep());
      return finish(
        "pvc-unbound",
        `The pod is waiting on a PersistentVolumeClaim${claim ? ` (likely ${claim})` : ""} that is not bound or not found. Scheduler says: ${clip(msg)}`,
        "status.conditions[PodScheduled].message",
        steps,
      );
    }
    if (s(sched.reason) === "Unschedulable") {
      return finish(
        "unschedulable",
        `The scheduler cannot place this pod. It says: ${clip(msg) || "no message"}`,
        "status.conditions[PodScheduled]",
        [evStep(), yamlStep("Check requests, nodeSelector, affinity and tolerations in YAML")],
      );
    }
  }

  // Probes failing, from events
  const probe = events.find((e) => e.reason === "Unhealthy" && /probe failed/i.test(s(e.message)));
  if (probe) {
    const c = main.find((x) => !x.ready) ?? main[0];
    return finish(
      "probe-failing",
      `A probe is failing: ${clip(s(probe.message))}. The container is likely not responding as the probe expects.`,
      "event Unhealthy",
      [
        yamlStep("Check the probe settings in YAML"),
        ...(c ? [{ label: "Read the container's logs", action: { kind: "logs", container: c.name, previous: false } } as ExplainStep] : []),
        evStep(),
      ],
    );
  }

  // Exited non-zero
  for (const c of cs) {
    if (c.terminated && typeof c.terminated.exitCode === "number" && c.terminated.exitCode !== 0) {
      const r = s(c.terminated.reason);
      return finish(
        "exited",
        `Container "${c.name}" exited with exit code ${c.terminated.exitCode}${r ? ` (${r})` : ""}.`,
        `${c.field}.state.terminated`,
        [{ label: "Read the container's logs", action: { kind: "logs", container: c.name, previous: false } }, evStep()],
      );
    }
  }

  // Normal startup: nothing to explain yet
  if (phase === "Pending" && cs.every((c) => !c.waiting || STARTING.has(s(c.waiting.reason)))) return null;

  return finish(
    "unknown",
    "This pod is not healthy, but no known cause was found in its status or events.",
    "status, status.containerStatuses, events",
    [evStep(), ...(main[0] ? [{ label: "Read the container's logs", action: { kind: "logs", container: main[0].name, previous: false } } as ExplainStep] : [])],
  );
}
