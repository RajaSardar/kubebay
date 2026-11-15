import { useMemo, useState } from "react";
import { Badge, Card, Row, Select, Stack, TextField } from "@kubebay/ui";
import { evaluateConnection, type SideVerdict } from "../lib/netpolEval";

type Obj = Record<string, unknown>;

function podKey(p: Obj): string {
  const meta = (p.metadata ?? {}) as Record<string, unknown>;
  return `${String(meta.namespace ?? "")}/${String(meta.name ?? "")}`;
}

function SideLine({ label, side }: { label: string; side: SideVerdict }) {
  return (
    <Row align="center" gap={2} wrap>
      <Badge tone={side.allowed ? "ok" : "err"}>{label}</Badge>
      <span className="small">
        {!side.isolated
          ? "not isolated: no policy selects this pod for this direction"
          : side.allowed
            ? `isolated by ${side.selectingPolicies.join(", ")}; allowed by ${side.allowingPolicies.join(", ")}${
                side.allowedPorts ? ` — only on ${side.allowedPorts.join(", ")}` : ""
              }`
            : `isolated by ${side.selectingPolicies.join(", ")}; no rule allows this traffic`}
      </span>
    </Row>
  );
}

/** Roadmap Tier 2 #12: "can pod A reach pod B?" on the NetworkPolicy page, from lib/netpolEval. */
export function ReachabilityCheck({ pods, policies, namespaces }: { pods: Obj[]; policies: Obj[]; namespaces: Obj[] }) {
  const [src, setSrc] = useState("");
  const [dst, setDst] = useState("");
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState("TCP");

  const byKey = useMemo(() => new Map(pods.map((p) => [podKey(p), p])), [pods]);
  const keys = useMemo(() => [...byKey.keys()].sort(), [byKey]);

  const srcPod = byKey.get(src);
  const dstPod = byKey.get(dst);
  const portNum = Number(port);
  const verdict =
    srcPod && dstPod
      ? evaluateConnection({
          src: srcPod,
          dst: dstPod,
          port: port && Number.isInteger(portNum) && portNum > 0 ? { port: portNum, protocol } : undefined,
          policies,
          namespaces,
        })
      : null;

  return (
    <Card>
      <Stack gap={3}>
        <Row gap={2} wrap align="center">
          <Select aria-label="Source pod" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">Source pod…</option>
            {keys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
          <span className="muted">→</span>
          <Select aria-label="Destination pod" value={dst} onChange={(e) => setDst(e.target.value)}>
            <option value="">Destination pod…</option>
            {keys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
          <TextField aria-label="Port" placeholder="any port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
          <Select aria-label="Protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
            <option value="SCTP">SCTP</option>
          </Select>
        </Row>

        {!verdict ? (
          <div className="muted small">Pick a source and a destination pod to see whether policy lets traffic through.</div>
        ) : (
          <Stack gap={2}>
            <Row align="center" gap={2}>
              <Badge tone={verdict.allowed ? "ok" : "err"}>{verdict.allowed ? "Allowed" : "Blocked"}</Badge>
              <span className="mono small">
                {src} → {dst}
                {port ? ` on ${protocol}/${port}` : ""}
              </span>
            </Row>
            <SideLine label="Egress" side={verdict.egress} />
            <SideLine label="Ingress" side={verdict.ingress} />
          </Stack>
        )}

        <div className="muted small">
          Evaluated from NetworkPolicy objects only. The CNI has to enforce them, and CNI-specific policies (Cilium, Calico)
          aren't included.
        </div>
      </Stack>
    </Card>
  );
}
