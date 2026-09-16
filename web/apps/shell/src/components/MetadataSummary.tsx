import { Badge } from "@kubebay/ui";
import { ConditionsTable, type Condition } from "./ConditionsTable";
import { ageOf, fmtAge } from "../lib/resources";

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

/**
 * Generic per-resource summary: Created, Labels, Annotations, Owner References, and (when
 * present) Conditions — shown for any object that doesn't have a bespoke summary component
 * (Node, Service, Pod), which today get YAML + Events only.
 */
export function MetadataSummary({ obj }: { obj: Record<string, unknown> | null }) {
  if (!obj) {
    return <div className="muted small" style={{ padding: 14 }}>Could not load object data.</div>;
  }

  const meta = rec(obj.metadata);
  const status = rec(obj.status);
  const labels = rec(meta.labels) as Record<string, unknown>;
  const annotations = rec(meta.annotations) as Record<string, unknown>;
  const ownerRefs = arr(meta.ownerReferences);
  const conditions = arr(status.conditions) as unknown as Condition[];

  return (
    <div className="pod-summary" style={{ padding: 14, overflowY: "auto", flex: 1 }}>
      <Section title="Info">
        <KV k="Created" v={meta.creationTimestamp ? `${fmtAge(ageOf(obj))} ago` : "–"} />
      </Section>

      <Section title={`Labels (${Object.keys(labels).length})`}>
        {Object.keys(labels).length > 0 ? (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {Object.entries(labels).map(([k, v]) => (
              <Badge key={k}>{k}={str(v)}</Badge>
            ))}
          </div>
        ) : (
          <span className="muted small">No labels</span>
        )}
      </Section>

      <Section title={`Annotations (${Object.keys(annotations).length})`}>
        {Object.keys(annotations).length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
          </div>
        ) : (
          <span className="muted small">No annotations</span>
        )}
      </Section>

      {ownerRefs.length > 0 && (
        <Section title={`Owner References (${ownerRefs.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ownerRefs.map((o, i) => (
              <div key={i} className="small">
                <span className="muted">{str(o.kind)}</span> <span className="mono">{str(o.name)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {conditions.length > 0 && (
        <Section title={`Conditions (${conditions.length})`}>
          <ConditionsTable conditions={conditions} />
        </Section>
      )}
    </div>
  );
}
