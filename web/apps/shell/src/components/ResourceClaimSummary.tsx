import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Row, Stack, StatusDot } from "@kubebay/ui";
import { auditObjectHref } from "../lib/auditLinks";
import { claimDeviceClasses, claimState } from "../lib/dra";

type Obj = Record<string, unknown>;
const rec = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pod-section">
      <div className="pod-section-title">{title}</div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="pod-kv">
      <span className="muted small">{k}</span>
      <span className="small">{v}</span>
    </div>
  );
}

/** A DRA ResourceClaim: what it asks for, the devices it was given, and who holds it. */
export function ResourceClaimSummary({ obj }: { obj: Obj }) {
  const state = claimState(obj);
  const status = rec(obj.status);
  const results = arr(rec(rec(status.allocation).devices).results);
  const users = arr(status.reservedFor);
  const ns = str(rec(obj.metadata).namespace);

  return (
    <div className="pod-summary" style={{ padding: 14 }}>
      <Section title="Claim">
        <KV
          k="State"
          v={
            <Row gap={2} align="center">
              <StatusDot status={state.dot} />
              <span>{state.v}</span>
            </Row>
          }
        />
        <KV k="Device class" v={claimDeviceClasses(obj.spec)} />
      </Section>

      <Section title={`Allocated devices (${results.length})`}>
        {results.length === 0 ? (
          <span className="muted small">Not allocated yet: no device has been picked for this claim.</span>
        ) : (
          <Stack gap={1}>
            {results.map((r, i) => (
              <Row gap={2} align="center" key={i}>
                <span className="mono small">{[str(r.pool), str(r.device)].filter(Boolean).join("/")}</span>
                <span className="muted small">
                  {str(r.driver)} · request {str(r.request)}
                </span>
              </Row>
            ))}
          </Stack>
        )}
      </Section>

      {users.length > 0 && (
        <Section title={`Reserved for (${users.length})`}>
          <Stack gap={1}>
            {users.map((u) => {
              const href = auditObjectHref({ resource: str(u.resource), namespace: ns, name: str(u.name) });
              return (
                <span className="small" key={str(u.uid) || str(u.name)}>
                  {href ? (
                    <Link className="cell-link" to={href}>
                      {str(u.name)}
                    </Link>
                  ) : (
                    str(u.name)
                  )}
                  <span className="muted"> ({str(u.resource)})</span>
                </span>
              );
            })}
          </Stack>
        </Section>
      )}
    </div>
  );
}
