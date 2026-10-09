import { useState, type ReactNode } from "react";
import { Badge, Button, DataTable, InlineBanner, Row, Select, Stack, type BadgeTone } from "@kubebay/ui";
import { imageSigApi, type ImageSignatureRow, type ImageSignatureScope } from "../lib/api";

const STATUS: Record<ImageSignatureRow["status"], { tone?: BadgeTone; label: (r: ImageSignatureRow) => string }> = {
  signed: { tone: "ok", label: (r) => `signature found${r.method ? ` (${r.method})` : ""}` },
  unsigned: { tone: "warn", label: () => "no signature" },
  unknown: { label: () => "unknown" },
};

const VERIFY: Record<NonNullable<ImageSignatureRow["verification"]>, { tone?: BadgeTone; label: (r: ImageSignatureRow) => string }> = {
  verified: { tone: "ok", label: (r) => `verified by ${r.verifiedBy ?? "a policy key"}` },
  failed: { tone: "err", label: () => "verification failed" },
  keyless: { label: () => "keyless, not verified here" },
  "no-key": { label: () => "no policy key for this image" },
};

/**
 * The on-demand running-image signature check (Intelligence roadmap Tier 2
 * #17): the cluster-wide card on the RBAC page, and with a scope, one
 * workload's or one pod's drawer tab (backlog #45). Runs only on request,
 * because it contacts each image's registry.
 */
export function ImageSignatureCheck({ cluster, scope, title }: { cluster: string; scope?: ImageSignatureScope; title?: ReactNode }) {
  const [rows, setRows] = useState<ImageSignatureRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [access, setAccess] = useState<"anonymous" | "pull-secrets">("anonymous");

  async function check() {
    setBusy(true);
    setErr("");
    try {
      const pull = access === "pull-secrets";
      setRows(await (scope ? imageSigApi.check(cluster, pull, scope) : imageSigApi.check(cluster, pull)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const count = (s: ImageSignatureRow["status"]) => rows?.filter((r) => r.status === s).length ?? 0;

  return (
    <Stack gap={3}>
      <Row align="center" gap={2} wrap>
        {title}
        {rows && (
          <>
            <Badge tone="ok">{`${count("signed")} with a signature`}</Badge>
            <Badge tone={count("unsigned") ? "warn" : undefined}>{`${count("unsigned")} without`}</Badge>
            <Badge>{`${count("unknown")} unknown`}</Badge>
          </>
        )}
        <Select aria-label="Registry access" value={access} onChange={(e) => setAccess(e.target.value as typeof access)}>
          <option value="anonymous">Registries: anonymous</option>
          <option value="pull-secrets">Registries: use the pods&apos; pull secrets</option>
        </Select>
        <Button disabled={busy || !cluster} onClick={check}>
          {busy ? "Checking…" : rows ? "Check again" : "Check signatures"}
        </Button>
      </Row>
      <div className="muted small">
        Looks up the digest that is actually running in each image&apos;s registry for a cosign signature tag or a
        sigstore referrer, contacting registries anonymously unless you choose the pods&apos; pull secrets (read with
        your access, sent only to the registry each is for). A tag signature is verified against the public keys in the
        cluster&apos;s Kyverno and Sigstore policies for that image; keyless signatures are left to the admission
        controller.
      </div>
      {err && <InlineBanner flush>{err}</InlineBanner>}
      {rows && (
        <DataTable
          rows={rows}
          rowKey={(r) => `${r.image}@${r.digest ?? ""}`}
          empty={<div className="muted small">No running images to check.</div>}
          columns={[
            { key: "image", header: "Image", className: "mono small", render: (r) => r.image },
            {
              key: "status",
              header: "Signature",
              render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label(r)}</Badge>,
            },
            {
              key: "verify",
              header: "Verification",
              render: (r) => (r.verification ? <Badge tone={VERIFY[r.verification].tone}>{VERIFY[r.verification].label(r)}</Badge> : null),
            },
            { key: "why", header: "Detail", className: "muted small", render: (r) => (r.verification === "verified" ? "" : (r.reason ?? "")) },
            { key: "pods", header: "Pods", className: "mono small", render: (r) => r.pods },
            // A scoped check is one namespace by construction.
            ...(scope ? [] : [{ key: "ns", header: "Namespaces", className: "mono small", render: (r: ImageSignatureRow) => r.namespaces.join(", ") }]),
          ]}
        />
      )}
    </Stack>
  );
}
