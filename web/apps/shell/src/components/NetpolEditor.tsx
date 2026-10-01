import { useMemo, useState } from "react";
import { ArmedButton, Badge, Button, Card, InlineBanner, Row, Select, Stack, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { matchesSelector } from "../lib/labelSelector";
import {
  draftToPolicy,
  parseLabels,
  policyImpact,
  toYaml,
  type PeerDraft,
  type PolicyDraft,
  type RuleDraft,
} from "../lib/netpolBuilder";

type Obj = Record<string, unknown>;
type Mode = "open" | "deny" | "allow";
type Dir = "Ingress" | "Egress";

const SHOWN = 20;

function rec(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}

function newPeer(kind: PeerDraft["kind"]): PeerDraft {
  if (kind === "namespace") return { kind, namespace: "" };
  if (kind === "cidr") return { kind, cidr: "" };
  return { kind, labels: "" };
}

function RuleRows({ dir, rules, onChange }: { dir: Dir; rules: RuleDraft[]; onChange: (r: RuleDraft[]) => void }) {
  const set = (i: number, r: RuleDraft) => onChange(rules.map((x, j) => (j === i ? r : x)));
  return (
    <Stack gap={2}>
      {rules.map((r, i) => {
        const label = `${dir} rule ${i + 1}`;
        return (
          <Row key={i} gap={2} wrap align="center">
            <Select aria-label={`${label} peer`} value={r.peer.kind} onChange={(e) => set(i, { ...r, peer: newPeer(e.target.value as PeerDraft["kind"]) })}>
              <option value="pods">{dir === "Ingress" ? "from pods" : "to pods"}</option>
              <option value="namespace">{dir === "Ingress" ? "from a whole namespace" : "to a whole namespace"}</option>
              <option value="cidr">{dir === "Ingress" ? "from an IP range" : "to an IP range"}</option>
            </Select>
            {r.peer.kind === "pods" && (
              <>
                <TextField
                  aria-label={`${label} namespace`}
                  placeholder="same namespace"
                  value={r.peer.namespace ?? ""}
                  onChange={(e) => set(i, { ...r, peer: { ...(r.peer as Extract<PeerDraft, { kind: "pods" }>), namespace: e.target.value } })}
                />
                <TextField
                  aria-label={`${label} labels`}
                  placeholder="app=api (empty = all pods)"
                  value={r.peer.labels}
                  onChange={(e) => set(i, { ...r, peer: { ...(r.peer as Extract<PeerDraft, { kind: "pods" }>), labels: e.target.value } })}
                />
              </>
            )}
            {r.peer.kind === "namespace" && (
              <TextField
                aria-label={`${label} namespace`}
                placeholder="namespace"
                value={r.peer.namespace}
                onChange={(e) => set(i, { ...r, peer: { kind: "namespace", namespace: e.target.value } })}
              />
            )}
            {r.peer.kind === "cidr" && (
              <TextField
                aria-label={`${label} cidr`}
                placeholder="10.0.0.0/16"
                value={r.peer.cidr}
                onChange={(e) => set(i, { ...r, peer: { kind: "cidr", cidr: e.target.value } })}
              />
            )}
            <TextField aria-label={`${label} ports`} placeholder="8080, 53/UDP (empty = all)" value={r.ports} onChange={(e) => set(i, { ...r, ports: e.target.value })} />
            <Button variant="ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
              {`Remove ${dir.toLowerCase()} rule ${i + 1}`}
            </Button>
          </Row>
        );
      })}
      <div>
        <Button variant="ghost" onClick={() => onChange([...rules, { peer: newPeer("pods"), ports: "" }])}>
          {`Add ${dir.toLowerCase()} rule`}
        </Button>
      </div>
    </Stack>
  );
}

function ImpactList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Stack gap={1}>
      <div className="small strong">{title}</div>
      {items.slice(0, SHOWN).map((x) => (
        <div key={x} className="mono small">
          {x}
        </div>
      ))}
      {items.length > SHOWN && <div className="muted small">{`and ${items.length - SHOWN} more`}</div>}
    </Stack>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Intelligence roadmap Tier 2 #22: build a NetworkPolicy from a form, see its
 * YAML and its effect on live pods, dry-run it on the API server, then create
 * it. Create only appears once a dry run of exactly this policy has passed.
 */
export function NetpolEditor({ cluster, pods, policies, namespaces }: { cluster: string; pods: Obj[]; policies: Obj[]; namespaces: Obj[] }) {
  const [ns, setNs] = useState("");
  const [name, setName] = useState("");
  const [podLabels, setPodLabels] = useState("");
  const [ingressMode, setIngressMode] = useState<Mode>("open");
  const [egressMode, setEgressMode] = useState<Mode>("open");
  const [ingress, setIngress] = useState<RuleDraft[]>([]);
  const [egress, setEgress] = useState<RuleDraft[]>([]);
  const [allowDns, setAllowDns] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dryOkFor, setDryOkFor] = useState<string | null>(null);
  const [created, setCreated] = useState("");

  const nsNames = useMemo(
    () => namespaces.map((n) => String(rec(n.metadata).name ?? "")).filter(Boolean).sort(),
    [namespaces],
  );

  const draft: PolicyDraft = {
    name,
    namespace: ns,
    podLabels,
    ingress: ingressMode === "open" ? null : ingressMode === "deny" ? [] : ingress,
    egress: egressMode === "open" ? null : egressMode === "deny" ? [] : egress,
    allowDns,
  };
  const built = draftToPolicy(draft);
  // The create endpoint is a server-side apply, so a same-named policy is replaced.
  const replaces = policies.some((p) => rec(p.metadata).namespace === ns && rec(p.metadata).name === name);
  const yaml = built.ok ? toYaml(built.policy) : "";

  const selectedCount = useMemo(() => {
    const l = parseLabels(podLabels);
    if (!ns || !l.ok) return null;
    return pods.filter((p) => rec(p.metadata).namespace === ns && matchesSelector(rec(rec(p.metadata).labels) as Record<string, string>, { matchLabels: l.labels })).length;
  }, [pods, ns, podLabels]);

  const impact = useMemo(
    () => (built.ok ? policyImpact({ policy: built.policy, pods, policies, namespaces }) : null),
    // yaml is the policy's canonical form, so it stands in for the object here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yaml, pods, policies, namespaces],
  );

  async function run(dryRun: boolean) {
    setBusy(true);
    setErr("");
    setCreated("");
    try {
      await api.createResource({ cluster, yaml, dryRun });
      if (dryRun) setDryOkFor(yaml);
      else {
        setCreated(`Created ${ns}/${name}.`);
        setDryOkFor(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDryOkFor(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Row align="center" gap={2}>
          <strong>Build a NetworkPolicy</strong>
        </Row>
        <Row gap={2} wrap align="center">
          <Select aria-label="Namespace" value={ns} onChange={(e) => setNs(e.target.value)}>
            <option value="">Namespace…</option>
            {nsNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <TextField aria-label="Policy name" placeholder="policy name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField aria-label="Pod labels" placeholder="app=web (empty = every pod)" value={podLabels} onChange={(e) => setPodLabels(e.target.value)} />
          {selectedCount !== null && <span className="muted small">{`Selects ${plural(selectedCount, "pod", "pods")}`}</span>}
        </Row>

        <Row gap={2} wrap align="center">
          <Select aria-label="Ingress" value={ingressMode} onChange={(e) => setIngressMode(e.target.value as Mode)}>
            <option value="open">Ingress: not restricted</option>
            <option value="deny">Ingress: deny all</option>
            <option value="allow">Ingress: allow only…</option>
          </Select>
        </Row>
        {ingressMode === "allow" && <RuleRows dir="Ingress" rules={ingress} onChange={setIngress} />}

        <Row gap={2} wrap align="center">
          <Select aria-label="Egress" value={egressMode} onChange={(e) => setEgressMode(e.target.value as Mode)}>
            <option value="open">Egress: not restricted</option>
            <option value="deny">Egress: deny all</option>
            <option value="allow">Egress: allow only…</option>
          </Select>
          {egressMode !== "open" && (
            <Select aria-label="Egress DNS" value={allowDns ? "yes" : "no"} onChange={(e) => setAllowDns(e.target.value === "yes")}>
              <option value="yes">and allow DNS (kube-dns)</option>
              <option value="no">and block DNS too</option>
            </Select>
          )}
        </Row>
        {egressMode === "allow" && <RuleRows dir="Egress" rules={egress} onChange={setEgress} />}

        {!built.ok ? (
          <div className="muted small">{built.error}</div>
        ) : (
          <>
            <pre className="mono small">{yaml}</pre>
            {impact && (
              <Stack gap={2}>
                <Row gap={2} wrap>
                  <Badge tone={impact.isolated.length ? "warn" : undefined}>{plural(impact.isolated.length, "pod newly isolated", "pods newly isolated")}</Badge>
                  <Badge tone={impact.blocked.length ? "err" : undefined}>{plural(impact.blocked.length, "connection blocked", "connections blocked")}</Badge>
                  <Badge tone={impact.allowed.length ? "info" : undefined}>{plural(impact.allowed.length, "connection opened", "connections opened")}</Badge>
                  {impact.narrowed.length > 0 && <Badge tone="warn">{plural(impact.narrowed.length, "connection narrowed", "connections narrowed")}</Badge>}
                </Row>
                <ImpactList title="Newly isolated" items={impact.isolated} />
                <ImpactList title="Would be blocked" items={impact.blocked} />
                <ImpactList title="Would be opened" items={impact.allowed} />
                <ImpactList title="Restricted to some ports" items={impact.narrowed} />
                {impact.truncated && <div className="muted small">Large cluster: only the first 20,000 pod pairs were checked.</div>}
                <div className="muted small">
                  Evaluated against live pods with standard NetworkPolicy semantics. The CNI must enforce policy for any of
                  this to take effect.
                </div>
              </Stack>
            )}
            {replaces && (
              <InlineBanner tone="warn" flush>{`${ns}/${name} already exists; creating replaces it. The preview above shows the effect of that replacement.`}</InlineBanner>
            )}
            {err && <InlineBanner flush>{err}</InlineBanner>}
            {dryOkFor === yaml && <div className="small">Dry run passed: the API server accepted this policy.</div>}
            {created && <div className="small strong">{created}</div>}
            <Row gap={2}>
              <Button disabled={busy} onClick={() => run(true)}>
                Dry run
              </Button>
              {dryOkFor === yaml && (
                <ArmedButton
                  label={replaces ? "Replace policy" : "Create policy"}
                  confirmLabel={`${replaces ? "Replace" : "Create"} ${ns}/${name}?`}
                  variant={replaces ? "danger" : "primary"}
                  busy={busy}
                  onGo={() => run(false)}
                />
              )}
            </Row>
          </>
        )}
      </Stack>
    </Card>
  );
}
