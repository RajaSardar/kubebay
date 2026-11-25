import { describe, expect, it } from "vitest";
import {
  argoAutomatedSync,
  argoHistory,
  argoRollbackBlocker,
  argoRollbackRequest,
  availableFluxActions,
  fluxActionRequest,
  fluxKindOf,
  fluxSuspended,
  gitopsActionImpact,
} from "../gitopsActions";

const KS = "kustomize.toolkit.fluxcd.io/v1/kustomizations";
const target = { cluster: "c1", gvr: KS, ns: "flux-system", name: "apps" };
const now = new Date("2026-03-01T10:20:30.000Z");

describe("fluxKindOf", () => {
  it("knows which Flux kinds reconcile and which suspend", () => {
    expect(fluxKindOf(KS)).toMatchObject({ kind: "Kustomization", reconcile: true, suspend: true });
    expect(fluxKindOf("helm.toolkit.fluxcd.io/v2/helmreleases")).toMatchObject({ kind: "HelmRelease", reconcile: true, suspend: true });
    expect(fluxKindOf("source.toolkit.fluxcd.io/v1/gitrepositories")?.kind).toBe("GitRepository");
    expect(fluxKindOf("source.toolkit.fluxcd.io/v1/ocirepositories")?.kind).toBe("OCIRepository");
    expect(fluxKindOf("source.toolkit.fluxcd.io/v1/buckets")?.kind).toBe("Bucket");
    expect(fluxKindOf("image.toolkit.fluxcd.io/v1beta2/imagerepositories")).toMatchObject({ reconcile: true, suspend: true });
    expect(fluxKindOf("image.toolkit.fluxcd.io/v1beta2/imagepolicies")).toMatchObject({ reconcile: true, suspend: false });
  });
  it("returns null for anything else", () => {
    expect(fluxKindOf("apps/v1/deployments")).toBeNull();
    expect(fluxKindOf("notification.toolkit.fluxcd.io/v1beta3/alerts")).toBeNull();
  });
});

describe("flux actions", () => {
  it("offers reconcile and suspend on a live object, and only resume when suspended", () => {
    expect(availableFluxActions(KS, { spec: {} })).toEqual(["reconcile", "suspend"]);
    expect(availableFluxActions(KS, { spec: { suspend: true } })).toEqual(["resume"]);
    expect(availableFluxActions("image.toolkit.fluxcd.io/v1beta2/imagepolicies", {})).toEqual(["reconcile"]);
    expect(availableFluxActions("apps/v1/deployments", {})).toEqual([]);
  });
  it("reads the suspended flag", () => {
    expect(fluxSuspended({ spec: { suspend: true } })).toBe(true);
    expect(fluxSuspended({ spec: { suspend: false } })).toBe(false);
    expect(fluxSuspended({})).toBe(false);
  });
  it("reconcile annotates requestedAt with the current time", () => {
    const req = fluxActionRequest(target, "reconcile", now);
    expect(req).toMatchObject({ cluster: "c1", gvr: KS, ns: "flux-system", name: "apps", mode: "merge", action: "flux-reconcile", dryRun: false, force: false });
    expect(JSON.parse(req.yaml)).toEqual({
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      kind: "Kustomization",
      metadata: { name: "apps", namespace: "flux-system", annotations: { "reconcile.fluxcd.io/requestedAt": "2026-03-01T10:20:30.000Z" } },
    });
  });
  it("suspend and resume set spec.suspend", () => {
    expect(JSON.parse(fluxActionRequest(target, "suspend", now).yaml)).toEqual({
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      kind: "Kustomization",
      metadata: { name: "apps", namespace: "flux-system" },
      spec: { suspend: true },
    });
    const resume = fluxActionRequest(target, "resume", now);
    expect(resume.action).toBe("flux-resume");
    expect(JSON.parse(resume.yaml).spec).toEqual({ suspend: false });
  });
  it("refuses an action the kind does not support", () => {
    expect(() => fluxActionRequest({ ...target, gvr: "image.toolkit.fluxcd.io/v1beta2/imagepolicies" }, "suspend", now)).toThrow();
    expect(() => fluxActionRequest({ ...target, gvr: "apps/v1/deployments" }, "reconcile", now)).toThrow();
  });
});

const history = [
  { id: 1, revision: "aaaaaaa1111", deployedAt: "2026-01-01T00:00:00Z", source: { repoURL: "https://git/x", path: "a", targetRevision: "main" } },
  { id: 3, revision: "ccccccc3333", deployedAt: "2026-03-01T00:00:00Z", source: { repoURL: "https://git/x", path: "a", targetRevision: "main" } },
  { id: 2, revision: "bbbbbbb2222", deployedAt: "2026-02-01T00:00:00Z", source: { repoURL: "https://git/x", path: "a", targetRevision: "main" } },
];
const app = (extra: Record<string, unknown> = {}) => ({
  metadata: { name: "web", namespace: "argocd" },
  spec: { syncPolicy: { syncOptions: ["CreateNamespace=true"] } },
  status: { history },
  ...extra,
});
const argoTarget = { cluster: "c1", gvr: "argoproj.io/v1alpha1/applications", ns: "argocd", name: "web" };

describe("argo rollback", () => {
  it("lists history newest first and tolerates junk", () => {
    expect(argoHistory(app()).map((h) => h.id)).toEqual([3, 2, 1]);
    expect(argoHistory(app())[0]).toMatchObject({ revision: "ccccccc3333", deployedAt: "2026-03-01T00:00:00Z" });
    expect(argoHistory({ status: { history: [null, "x", { id: "no" }] } })).toEqual([]);
    expect(argoHistory({})).toEqual([]);
  });
  it("detects automated sync, including an empty automated block", () => {
    expect(argoAutomatedSync({ spec: { syncPolicy: { automated: { prune: true } } } })).toBe(true);
    expect(argoAutomatedSync({ spec: { syncPolicy: { automated: {} } } })).toBe(true);
    expect(argoAutomatedSync({ spec: { syncPolicy: {} } })).toBe(false);
    expect(argoAutomatedSync({ spec: { syncPolicy: { automated: null } } })).toBe(false);
  });
  it("explains why a rollback is refused", () => {
    expect(argoRollbackBlocker(app())).toBeNull();
    const auto = { spec: { syncPolicy: { automated: {} } }, status: { history } };
    expect(argoRollbackBlocker(auto)).toMatch(/automated sync/i);
    expect(argoRollbackBlocker(auto)).toMatch(/reverted/i);
    expect(argoRollbackBlocker({ spec: {}, status: {} })).toMatch(/no history/i);
    expect(argoRollbackBlocker(app({ operation: { sync: {} } }))).toMatch(/already/i);
  });
  it("patches operation.sync with the history entry, as the Argo CD API does", () => {
    const req = argoRollbackRequest(argoTarget, app(), 2, { prune: true });
    expect(req).toMatchObject({ cluster: "c1", gvr: "argoproj.io/v1alpha1/applications", ns: "argocd", name: "web", mode: "merge", action: "argocd-rollback", dryRun: false });
    expect(JSON.parse(req.yaml)).toEqual({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "web", namespace: "argocd" },
      operation: {
        sync: {
          revision: "bbbbbbb2222",
          prune: true,
          syncOptions: ["CreateNamespace=true"],
          source: history[2]!.source,
        },
      },
    });
  });
  it("carries the prune choice, and multi-source history", () => {
    const multi = { ...app(), status: { history: [{ id: 5, revision: "r", revisions: ["r1", "r2"], sources: [{ repoURL: "u1" }, { repoURL: "u2" }] }] } };
    const body = JSON.parse(argoRollbackRequest(argoTarget, multi, 5, { prune: false }).yaml);
    expect(body.operation.sync).toEqual({ revision: "r", revisions: ["r1", "r2"], prune: false, syncOptions: ["CreateNamespace=true"], sources: [{ repoURL: "u1" }, { repoURL: "u2" }] });
    expect(JSON.parse(argoRollbackRequest(argoTarget, app(), 1, { prune: true }).yaml).operation.sync.prune).toBe(true);
  });
  it("throws when blocked or the entry is unknown", () => {
    expect(() => argoRollbackRequest(argoTarget, app(), 99, { prune: false })).toThrow(/history/i);
    expect(() => argoRollbackRequest(argoTarget, { spec: { syncPolicy: { automated: {} } }, status: { history } }, 1, { prune: false })).toThrow(/automated/i);
  });
});

describe("gitopsActionImpact", () => {
  it("says what a Flux action touches", () => {
    const obj = { status: { inventory: { entries: [{ id: "a" }, { id: "b" }] } } };
    expect(gitopsActionImpact("reconcile", obj).join(" ")).toMatch(/2 resources/);
    expect(gitopsActionImpact("suspend", obj).join(" ")).toMatch(/stops reconciling/i);
    expect(gitopsActionImpact("resume", obj).join(" ")).toMatch(/reconciles again/i);
  });
  it("says what an Argo rollback touches", () => {
    const obj = { status: { resources: [{ kind: "Deployment" }, { kind: "Service" }, { kind: "Pod" }] } };
    const lines = gitopsActionImpact("argocd-rollback", obj, { prune: true });
    expect(lines.join(" ")).toMatch(/3 resources/);
    expect(lines.join(" ")).toMatch(/prune/i);
  });
});
