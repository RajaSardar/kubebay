import { useState } from "react";
import { Badge, Button, Card, DataTable, InlineBanner, Row, Stack, type BadgeTone } from "@kubebay/ui";
import { imageSigApi, type ImageSignatureRow } from "../lib/api";

const STATUS: Record<ImageSignatureRow["status"], { tone?: BadgeTone; label: (r: ImageSignatureRow) => string }> = {
  signed: { tone: "ok", label: (r) => `signature found${r.method ? ` (${r.method})` : ""}` },
  unsigned: { tone: "warn", label: () => "no signature" },
  unknown: { label: () => "unknown" },
};

/**
 * Intelligence roadmap Tier 2 #17: is a signature published for each image
 * digest actually running? Complements #32's "is verification enforced?".
 * Runs only on request because it contacts every image's registry.
 */
export function RunningImageSignaturesCard({ cluster }: { cluster: string }) {
  const [rows, setRows] = useState<ImageSignatureRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function check() {
    setBusy(true);
    setErr("");
    try {
      setRows(await imageSigApi.check(cluster));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const count = (s: ImageSignatureRow["status"]) => rows?.filter((r) => r.status === s).length ?? 0;

  return (
    <Card style={{ marginBottom: 16 }}>
      <Stack gap={3}>
        <Row align="center" gap={2} wrap>
          <strong>Running image signatures</strong>
          {rows && (
            <>
              <Badge tone="ok">{`${count("signed")} with a signature`}</Badge>
              <Badge tone={count("unsigned") ? "warn" : undefined}>{`${count("unsigned")} without`}</Badge>
              <Badge>{`${count("unknown")} unknown`}</Badge>
            </>
          )}
          <Button disabled={busy || !cluster} onClick={check}>
            {busy ? "Checking…" : rows ? "Check again" : "Check signatures"}
          </Button>
        </Row>
        <div className="muted small">
          Contacts each image's registry anonymously, by the digest that is actually running, and looks for a cosign
          signature tag or a sigstore referrer. A signature found here is not verified against a key or identity; that
          is what an enforcing admission policy does. Private registries show as unknown.
        </div>
        {err && <InlineBanner flush>{err}</InlineBanner>}
        {rows && (
          <DataTable
            rows={rows}
            rowKey={(r) => `${r.image}@${r.digest ?? ""}`}
            columns={[
              { key: "image", header: "Image", className: "mono small", render: (r) => r.image },
              {
                key: "status",
                header: "Signature",
                render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label(r)}</Badge>,
              },
              { key: "why", header: "Detail", className: "muted small", render: (r) => (r.status === "signed" ? "" : (r.reason ?? "")) },
              { key: "pods", header: "Pods", className: "mono small", render: (r) => r.pods },
              { key: "ns", header: "Namespaces", className: "mono small", render: (r) => r.namespaces.join(", ") },
            ]}
          />
        )}
      </Stack>
    </Card>
  );
}
