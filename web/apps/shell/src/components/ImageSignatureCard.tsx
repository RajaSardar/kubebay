import { Badge, Card, Row, Stack } from "@kubebay/ui";
import type { ImageSignatureReport } from "../lib/imageSignature";
import { ControlTags } from "./ControlTags";
import { controlsFor } from "../lib/controlIds";

const STATUS: Record<ImageSignatureReport["status"], { label: string; tone: "ok" | "warn" | "err" }> = {
  enforced: { label: "Enforced", tone: "ok" },
  partial: { label: "Partly enforced", tone: "warn" },
  "audit-only": { label: "Audit only", tone: "warn" },
  none: { label: "Not verified", tone: "err" },
};

/** How many application namespaces enforce signatures, and which don't. */
function CoverageSummary({ namespaces }: { namespaces: ImageSignatureReport["namespaces"] }) {
  const apps = namespaces.filter((n) => !n.system);
  if (apps.length === 0) return null;
  const enforced = apps.filter((n) => n.mode === "enforce").length;
  const gaps = apps.filter((n) => n.mode !== "enforce");
  const shown = gaps.slice(0, 10).map((n) => (n.mode === "audit" ? `${n.name} (audit only)` : n.name));
  return (
    <Stack gap={1}>
      <div className="small">{`Enforced in ${enforced} of ${apps.length} namespaces (system namespaces aside).`}</div>
      {gaps.length > 0 && (
        <div className="small muted">
          {`Unsigned images can run in: ${shown.join(", ")}${gaps.length > shown.length ? ` and ${gaps.length - shown.length} more` : ""}.`}
        </div>
      )}
    </Stack>
  );
}

/** Backlog #32: another stacked security card on the RBAC page, alongside RbacFindingsCard and friends. */
export function ImageSignatureCard({ report, enginesInstalled }: { report: ImageSignatureReport; enginesInstalled: boolean }) {
  const s = STATUS[report.status];
  return (
    <Card style={{ marginBottom: 16 }}>
      <Row align="center" gap={2} className="rbac-section-title">
        Image signature verification
        <Badge tone={s.tone}>{s.label}</Badge>
        <ControlTags controls={controlsFor("unverified-images")} />
      </Row>

      {!enginesInstalled ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          No signature-verification engine installed (Kyverno, Sigstore policy-controller, Ratify or Connaisseur) — any
          image can run.
        </div>
      ) : report.policies.length === 0 ? (
        <div className="muted small" style={{ marginTop: 10 }}>
          No policy verifies image signatures — any image can run.
        </div>
      ) : (
        <Stack gap={2} style={{ marginTop: 10 }}>
          {report.policies.map((p) => (
            <Row key={`${p.engine}/${p.ns ?? ""}/${p.name}`} align="center" gap={2} wrap>
              <Badge tone={p.mode === "enforce" ? "ok" : "warn"}>{p.mode}</Badge>
              <span className="small muted">{p.engine}</span>
              <span className="mono strong small">{p.name}</span>
              {p.ns && <span className="muted small">{p.ns}</span>}
              {p.images.map((img) => (
                <Badge key={img}>{img}</Badge>
              ))}
            </Row>
          ))}
          <CoverageSummary namespaces={report.namespaces} />
          {report.policies.some((p) => p.engine === "connaisseur") && (
            <div className="small muted">
              Connaisseur keeps its rules in a ConfigMap the Kubernetes API doesn&apos;t describe, so only where its webhook
              applies is shown. It denies unsigned images unless detection mode is on.
            </div>
          )}
          {report.policies.some((p) => p.engine === "sigstore") && (
            <div className="small muted">
              Sigstore applies only in namespaces labelled <span className="mono">policy.sigstore.dev/include=true</span>:{" "}
              {report.sigstoreNamespaces.length > 0 ? report.sigstoreNamespaces.join(", ") : "none"}.
            </div>
          )}
        </Stack>
      )}
    </Card>
  );
}
