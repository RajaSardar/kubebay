import { Badge, Card, Row, Stack } from "@kubebay/ui";
import type { ImageSignatureReport } from "../lib/imageSignature";
import { ControlTags } from "./ControlTags";
import { controlsFor } from "../lib/controlIds";

const STATUS: Record<ImageSignatureReport["status"], { label: string; tone: "ok" | "warn" | "err" }> = {
  enforced: { label: "Enforced", tone: "ok" },
  "audit-only": { label: "Audit only", tone: "warn" },
  none: { label: "Not verified", tone: "err" },
};

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
          No signature-verification engine installed (Kyverno or Sigstore policy-controller) — any image can run.
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
