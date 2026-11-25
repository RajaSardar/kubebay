import { matchesSelector, type LabelSelector } from "./labelSelector";

// Backlog #80: admission webhooks that can deadlock a drain or an upgrade.
// failurePolicy defaults to Fail in admissionregistration.k8s.io/v1, so a
// webhook with no policy is treated as Fail.
type Obj = Record<string, unknown>;
const rec = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The API server's default is 10s and the maximum 30s; from here a slow webhook holds up every matching request. */
export const HIGH_TIMEOUT_SECONDS = 15;

export type WebhookFindingKind = "no-ready-endpoints" | "matches-kube-system" | "no-self-exclusion" | "high-timeout";

export interface WebhookFinding {
  kind: WebhookFindingKind;
  configKind: "ValidatingWebhookConfiguration" | "MutatingWebhookConfiguration";
  config: string;
  webhook: string;
  failurePolicy: string;
  detail: string;
  why: string;
}

const nsLabels = (ns: string) => ({ "kubernetes.io/metadata.name": ns });

export function webhookFindings(input: { validating: Obj[]; mutating: Obj[]; endpoints: Obj[] | undefined }): WebhookFinding[] {
  const ready = new Set<string>();
  for (const e of input.endpoints ?? []) {
    const m = rec(e.metadata);
    if (arr(e.subsets).some((s) => arr(rec(s).addresses).length > 0)) ready.add(`${str(m.namespace)}/${str(m.name)}`);
  }
  const out: WebhookFinding[] = [];
  const scan = (configs: Obj[], configKind: WebhookFinding["configKind"]) => {
    for (const c of configs) {
      const config = str(rec(c.metadata).name);
      for (const w of arr(c.webhooks)) {
        const wh = rec(w);
        const webhook = str(wh.name);
        const failurePolicy = str(wh.failurePolicy) || "Fail";
        const base = { configKind, config, webhook, failurePolicy };
        const svc = rec(rec(wh.clientConfig).service);
        const svcNs = str(svc.namespace);
        const svcName = str(svc.name);
        const selector = (wh.namespaceSelector ?? {}) as LabelSelector;

        if (failurePolicy === "Fail") {
          if (svcName && input.endpoints && !ready.has(`${svcNs}/${svcName}`)) {
            out.push({
              ...base,
              kind: "no-ready-endpoints",
              detail: `Service ${svcNs}/${svcName} has no ready endpoints.`,
              why: "With failurePolicy Fail, every matching request is rejected while the service is down. A drain evicts the webhook's own pods, and replacement pods can then be refused, so the upgrade stalls.",
            });
          }
          if (matchesSelector(nsLabels("kube-system"), selector)) {
            out.push({
              ...base,
              kind: "matches-kube-system",
              detail: "Its namespaceSelector does not exclude kube-system.",
              why: "System pods (CoreDNS, kube-proxy, CNI) are recreated during an upgrade. If this webhook is unavailable they are rejected and the node never becomes ready.",
            });
          }
          if (svcNs && matchesSelector(nsLabels(svcNs), selector)) {
            out.push({
              ...base,
              kind: "no-self-exclusion",
              detail: `Its namespaceSelector does not exclude its own namespace, ${svcNs}.`,
              why: "A webhook that guards its own pods can't be restarted once it is down: the new pod is refused by the webhook that pod would serve.",
            });
          }
        }
        const timeout = typeof wh.timeoutSeconds === "number" ? wh.timeoutSeconds : undefined;
        if (timeout !== undefined && timeout >= HIGH_TIMEOUT_SECONDS) {
          out.push({
            ...base,
            kind: "high-timeout",
            detail: `timeoutSeconds is ${timeout}.`,
            why: "While a slow webhook runs out its timeout, each matching request waits, so evictions and pod creation crawl during a rolling upgrade.",
          });
        }
      }
    }
  };
  scan(input.validating, "ValidatingWebhookConfiguration");
  scan(input.mutating, "MutatingWebhookConfiguration");
  return out;
}
