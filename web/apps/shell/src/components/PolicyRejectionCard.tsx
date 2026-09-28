import { InlineBanner } from "@kubebay/ui";
import type { PolicyRejectionDetail } from "../lib/policyRejection";

/**
 * The structured pre-flight card for an admission-webhook denial — extracted
 * out of YamlTab.tsx (backlog #17) so every mutating call site can render the
 * same card instead of a plain error string, now that PolicyRejectionError
 * is thrown by every api.* call via the shared send() helper, not just apply.
 */
export function PolicyRejectionCard({ rejection, flush = true }: { rejection: PolicyRejectionDetail; flush?: boolean }) {
  return (
    <InlineBanner flush={flush} role="alert">
      <div>
        <strong>
          {rejection.engine ? `${rejection.engine} policy rejected this change` : "Policy rejected this change"}
        </strong>
        {rejection.webhook && <span className="muted small mono" style={{ marginLeft: 8 }}>{rejection.webhook}</span>}
      </div>
      <div className="small">{rejection.message}</div>
      {rejection.causes && rejection.causes.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {rejection.causes.map((c, i) => (
            <li key={i} className="small">
              {c.field && <span className="mono muted">{c.field}: </span>}
              {c.message}
            </li>
          ))}
        </ul>
      )}
    </InlineBanner>
  );
}
