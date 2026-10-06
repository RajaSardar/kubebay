import { Badge, Row, Stack } from "@kubebay/ui";
import { ConditionsTable, type Condition } from "./ConditionsTable";
import { ageOf, fmtAge } from "../lib/resources";
import { ownerOf, ownerLabel } from "../lib/gitops";
import { useOwnerChain } from "../lib/useOwnerChain";
import { ResourceLink } from "./ResourceLink";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pod-section">
      <div className="pod-section-title">{title}</div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="pod-kv">
      <span className="muted small">{k}</span>
      <span className="small">{v}</span>
    </div>
  );
}

// Very long annotation values (e.g. last-applied-configuration JSON blobs) are truncated so
// one entry can't blow out the whole panel.
const MAX_ANNOTATION_LEN = 120;

function OwnerChainRow({
  cluster,
  ns,
  rawOwnerRefs,
}: {
  cluster: string;
  ns: string;
  rawOwnerRefs: { apiVersion?: string; kind: string; name: string; controller?: boolean }[];
}) {
  const chain = useOwnerChain(cluster, ns, rawOwnerRefs);
  if (!chain.length) return null;
  return (
    <Section title="Owned by">
      <Row gap={1} wrap align="center">
        {chain.map((o, i) => (
          <Row key={i} gap={1} align="center">
            {i > 0 && <span className="muted small">←</span>}
            <ResourceLink kind={o.slug} ns={o.ns} name={o.name}>
              <span className="mono small">{o.kind}/{o.name}</span>
            </ResourceLink>
          </Row>
        ))}
      </Row>
    </Section>
  );
}

/**
 * Generic per-resource summary: Created, Labels, Annotations, Owner References (as clickable
 * chain when cluster+ns are provided), and (when present) Conditions.
 */
export function MetadataSummary({
  obj,
  cluster,
  ns,
}: {
  obj: Record<string, unknown> | null;
  cluster?: string;
  ns?: string;
}) {
  if (!obj) {
    return <div className="muted small" style={{ padding: 14 }}>Could not load object data.</div>;
  }

  const meta = rec(obj.metadata);
  const status = rec(obj.status);
  const labels = rec(meta.labels) as Record<string, unknown>;
  const annotations = rec(meta.annotations) as Record<string, unknown>;
  const rawOwnerRefs = arr(meta.ownerReferences) as { apiVersion?: string; kind: string; name: string; controller?: boolean }[];
  const conditions = arr(status.conditions) as unknown as Condition[];
  const gitopsOwner = ownerOf(obj);
  const effectiveNs = ns ?? str(meta.namespace);

  return (
    <div className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      <Section title="Info">
        <KV k="Created" v={meta.creationTimestamp ? `${fmtAge(ageOf(obj))} ago` : "–"} />
        {gitopsOwner && <KV k="Managed by" v={<Badge>{ownerLabel(gitopsOwner)}</Badge>} />}
      </Section>

      {/* Owner chain — clickable links with multi-level tracing when cluster is available */}
      {rawOwnerRefs.length > 0 && cluster && effectiveNs ? (
        <OwnerChainRow cluster={cluster} ns={effectiveNs} rawOwnerRefs={rawOwnerRefs} />
      ) : rawOwnerRefs.length > 0 ? (
        <Section title={`Owner References (${rawOwnerRefs.length})`}>
          <Stack gap={1}>
            {rawOwnerRefs.map((o, i) => (
              <div key={i} className="small">
                <span className="muted">{str(o.kind)}</span> <span className="mono">{str(o.name)}</span>
              </div>
            ))}
          </Stack>
        </Section>
      ) : null}

      <Section title={`Labels (${Object.keys(labels).length})`}>
        {Object.keys(labels).length > 0 ? (
          <Row gap={1} wrap>
            {Object.entries(labels).map(([k, v]) => (
              <Badge key={k}>{k}={str(v)}</Badge>
            ))}
          </Row>
        ) : (
          <span className="muted small">No labels</span>
        )}
      </Section>

      <Section title={`Annotations (${Object.keys(annotations).length})`}>
        {Object.keys(annotations).length > 0 ? (
          <Stack gap={1}>
            {Object.entries(annotations).map(([k, v]) => {
              const value = str(v);
              const truncated = value.length > MAX_ANNOTATION_LEN;
              return (
                <div key={k} className="pod-kv" style={{ alignItems: "flex-start" }}>
                  <span className="muted small mono">{k}</span>
                  <span className="small mono" title={truncated ? value : undefined}>
                    {truncated ? `${value.slice(0, MAX_ANNOTATION_LEN)}…` : value}
                  </span>
                </div>
              );
            })}
          </Stack>
        ) : (
          <span className="muted small">No annotations</span>
        )}
      </Section>

      {conditions.length > 0 && (
        <Section title={`Conditions (${conditions.length})`}>
          <ConditionsTable conditions={conditions} />
        </Section>
      )}
    </div>
  );
}
