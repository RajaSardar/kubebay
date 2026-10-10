import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArmedButton, Badge, Button, Card, InlineBanner, Row, Stack, TextField } from "@kubebay/ui";
import { api, triageApi, type TriageStatus } from "../lib/api";

interface Draft {
  clusters: string[];
  baseURL: string;
  model: string;
}

function draftFrom(st: TriageStatus): Draft {
  return { clusters: st.clusters ?? [], baseURL: st.baseURL, model: st.model };
}

/**
 * Backlog #13: incident triage's switch, cluster allowlist, endpoint, model
 * and API key. Off by default; the key lives in the OS keychain or the
 * environment and is never shown or stored in settings.
 */
export function TriageSettingsCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["triage"], queryFn: triageApi.get });
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const [edited, setEdited] = useState<Draft | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const st = status.data;
  if (!st) return null;
  const draft = edited ?? draftFrom(st);
  const ids = [...new Set([...(clusters.data ?? []).map((c) => c.id), ...(st.clusters ?? [])])].sort();

  const run = async (call: () => Promise<TriageStatus>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(["triage"], await call());
      setEdited(null);
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggleCluster = (id: string, on: boolean) =>
    setEdited({ ...draft, clusters: on ? [...draft.clusters, id].sort() : draft.clusters.filter((c) => c !== id) });

  return (
    <Card id="triage" style={{ marginTop: 18 }}>
      <Row align="center" gap={2}>
        <div className="rbac-section-title">AI incident triage</div>
        {st.enabled && <Badge tone="warn">on</Badge>}
      </Row>
      <Stack gap={3}>
        <div className="muted small">
          When it&apos;s on, pods in the clusters you allow get a Triage tab. It gathers a bounded evidence bundle (the
          pod, its owners, warnings, recent rollouts and logs, with credentials masked) and shows exactly what would be
          sent to the model before anything is. Each preview is written to the audit log.
        </div>
        {st.disabled ? (
          <InlineBanner tone="warn" flush>
            Triage isn&apos;t available here: {st.disabled}.
          </InlineBanner>
        ) : (
          <>
            <Stack gap={2}>
              {ids.length === 0 && <div className="muted small">No clusters in your kubeconfig yet.</div>}
              {ids.map((id) => (
                <label key={id} className="ctl" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    aria-label={`Allow ${id}`}
                    checked={draft.clusters.includes(id)}
                    onChange={(e) => toggleCluster(id, e.target.checked)}
                  />
                  <span className="mono small strong">{id}</span>
                </label>
              ))}
            </Stack>
            <Row gap={3} wrap>
              <Stack gap={1}>
                <span className="muted small">Endpoint</span>
                <TextField
                  aria-label="Endpoint"
                  style={{ width: 320 }}
                  placeholder="https://api.anthropic.com"
                  value={draft.baseURL}
                  onChange={(e) => setEdited({ ...draft, baseURL: e.target.value })}
                  spellCheck={false}
                />
              </Stack>
              <Stack gap={1}>
                <span className="muted small">Model</span>
                <TextField
                  aria-label="Model"
                  style={{ width: 220 }}
                  placeholder="claude-opus-5-5"
                  value={draft.model}
                  onChange={(e) => setEdited({ ...draft, model: e.target.value })}
                  spellCheck={false}
                />
              </Stack>
            </Row>
            <div className="muted small">
              The endpoint takes Anthropic&apos;s Messages API or a proxy that speaks it, over https (http only on this
              machine).
            </div>
            {error && <InlineBanner flush>{error}</InlineBanner>}
            <Row gap={2} align="center" wrap>
              {st.enabled ? (
                <>
                  <Button disabled={busy || !edited || draft.clusters.length === 0} onClick={() => void run(() => triageApi.save({ enabled: true, ...draft }))}>
                    Save
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void run(() => triageApi.save({ enabled: false, ...draftFrom(st) }))}>
                    Turn off
                  </Button>
                </>
              ) : (
                <Button disabled={busy || draft.clusters.length === 0} onClick={() => void run(() => triageApi.save({ enabled: true, ...draft }))}>
                  Turn on
                </Button>
              )}
            </Row>
            <Stack gap={2}>
              <div className="strong small">API key</div>
              {st.key.source.startsWith("env:") ? (
                <div className="muted small">
                  Using the key in <span className="mono">{st.key.source.slice(4)}</span> from Kubebay&apos;s environment.
                </div>
              ) : st.key.source === "keychain" ? (
                <Row gap={2} align="center" wrap>
                  <span className="muted small">Key saved in {st.key.store}.</span>
                  <ArmedButton label="Remove key" confirmLabel="Remove the key?" busy={busy} onGo={() => void run(triageApi.deleteKey)} />
                </Row>
              ) : st.key.store ? (
                <Row gap={2} align="center" wrap>
                  <TextField
                    aria-label="API key"
                    type="password"
                    autoComplete="off"
                    placeholder="sk-ant-…"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    spellCheck={false}
                    style={{ flex: 1, minWidth: 220 }}
                  />
                  <Button disabled={busy || !keyDraft.trim()} onClick={() => void run(() => triageApi.putKey(keyDraft.trim()), () => setKeyDraft(""))}>
                    Save key
                  </Button>
                  <span className="muted small">Kept in {st.key.store}, never in Kubebay&apos;s settings.</span>
                </Row>
              ) : (
                <div className="muted small">
                  There&apos;s no keychain to save to here. Set <span className="mono">KUBEBAY_TRIAGE_API_KEY</span> in
                  Kubebay&apos;s environment.
                </div>
              )}
              {st.key.error && <InlineBanner tone="warn" flush>{st.key.error}</InlineBanner>}
            </Stack>
          </>
        )}
      </Stack>
    </Card>
  );
}
