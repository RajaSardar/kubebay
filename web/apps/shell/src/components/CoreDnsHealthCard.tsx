import { Badge, Card, Row, Stack } from "@kubebay/ui";
import type { CoreDnsReport } from "../lib/coreDnsHealth";

export function CoreDnsHealthCard({ report }: { report: CoreDnsReport }) {
  const { present, corefileChecked, findings } = report;
  return (
    <Card>
      <Row align="center" gap={2} style={{ marginBottom: 8 }}>
        <strong>Cluster DNS</strong>
        {present && <Badge tone={findings.length > 0 ? "err" : "ok"}>{findings.length}</Badge>}
      </Row>
      {!present ? (
        <div className="muted small">No CoreDNS or kube-dns deployment found in kube-system.</div>
      ) : findings.length === 0 ? (
        <div className="muted small">
          Cluster DNS looks healthy.{!corefileChecked && " Corefile not checked — the coredns ConfigMap isn't readable."}
        </div>
      ) : (
        <Stack gap={1}>
          {findings.map((f) => (
            <div key={f.kind} className="small">
              {f.detail}
            </div>
          ))}
          {!corefileChecked && <div className="muted small">Corefile not checked — the coredns ConfigMap isn't readable.</div>}
        </Stack>
      )}
    </Card>
  );
}
