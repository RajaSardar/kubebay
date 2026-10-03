import { useEffect, useRef, useState } from "react";
import { ArmedButton, Button, Card, InlineBanner, Row, Select, Stack, TextField } from "@kubebay/ui";
import { ExecTerm } from "./heavy";
import { api, netdiagApi } from "../lib/api";

type Running = { ns: string; pod: string };

/**
 * Intelligence roadmap Tier 2 #23: a short-lived network diagnostic pod
 * (dig, curl, traceroute) in a namespace of the user's choosing, opened in
 * a terminal. Complements the static ReachabilityCheck with a live test.
 * The pod is deleted on Stop or when this card unmounts, and the engine
 * gives it a one-hour deadline in case neither happens.
 */
export function NetDiagCard({ cluster, namespaces }: { cluster: string; namespaces: string[] }) {
  const [ns, setNs] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [running, setRunning] = useState<Running | null>(null);
  // The unmount cleanup closes over the first render, so it reads the pod from a ref.
  const runningRef = useRef<Running | null>(null);

  const remove = (r: Running) => {
    api.deleteResource({ cluster, gvr: "v1/pods", ns: r.ns, name: r.pod }).catch(() => {});
  };

  useEffect(
    () => () => {
      if (runningRef.current) remove(runningRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster],
  );

  async function start() {
    setBusy(true);
    setErr("");
    try {
      const r = await netdiagApi.start({ cluster, namespace: ns, ...(image.trim() ? { image: image.trim() } : {}) });
      const next = { ns: r.namespace, pod: r.pod };
      runningRef.current = next;
      setRunning(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    if (!running) return;
    remove(running);
    runningRef.current = null;
    setRunning(null);
  }

  if (running) {
    return (
      <Card>
        <Stack gap={2}>
          <Row align="center" gap={2} wrap>
            <strong>Live network check</strong>
            <span className="mono small">
              {running.ns}/{running.pod}
            </span>
            <Button variant="danger-ghost" onClick={stop}>
              Stop and delete pod
            </Button>
          </Row>
          <div className="muted small">
            Try <span className="mono">dig my-svc.{running.ns}.svc.cluster.local</span>,{" "}
            <span className="mono">curl -v http://my-svc:8080</span> or <span className="mono">traceroute 10.0.0.1</span>.
          </div>
          <div className="term-wrap" style={{ height: 360 }}>
            <ExecTerm cluster={cluster} namespace={running.ns} pod={running.pod} container="netdiag" />
          </div>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <Stack gap={3}>
        <strong>Live network check</strong>
        <div className="muted small">
          Starts a short-lived pod with dig, curl and traceroute in the namespace you pick, so DNS and NetworkPolicies
          apply to it as they do to that namespace's pods. It has no privileges and no API token, carries only Kubebay's
          own labels, is deleted when you stop or leave, and stops itself after an hour regardless.
        </div>
        {err && <InlineBanner flush>{err}</InlineBanner>}
        <Row gap={2} wrap align="center">
          <Select aria-label="Namespace" value={ns} onChange={(e) => setNs(e.target.value)}>
            <option value="">Namespace…</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <TextField aria-label="Image" placeholder="nicolaka/netshoot:v0.13" value={image} onChange={(e) => setImage(e.target.value)} />
          {ns && (
            <ArmedButton
              label="Start diagnostic pod"
              confirmLabel={`Create a pod in ${ns}?`}
              variant="primary"
              busy={busy}
              onGo={start}
            />
          )}
        </Row>
      </Stack>
    </Card>
  );
}
