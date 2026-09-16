import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCluster } from "../lib/useCluster";
import { DEFS, EXTRA_DEFS } from "../lib/resources";
import type { ResourceDef } from "../lib/resources";
import GenericDrawer from "../components/GenericDrawer";

function lookupDef(kind: string, sp: URLSearchParams): ResourceDef | undefined {
  if (DEFS[kind]) return DEFS[kind];
  if (EXTRA_DEFS[kind]) return EXTRA_DEFS[kind];
  if (kind.startsWith("ext--")) {
    const parts = kind.slice(5).split("--");
    if (parts.length < 3) return undefined;
    const resource = parts[parts.length - 1] ?? "";
    const version = parts[parts.length - 2] ?? "";
    const group = parts.slice(0, -2).join(".");
    const gvr = group ? `${group}/${version}/${resource}` : `${version}/${resource}`;
    return {
      slug: kind,
      label: resource,
      gvr,
      group,
      resource,
      scoped: sp.get("scoped") === "0",
      mode: "full",
    };
  }
  return undefined;
}

export default function ResourceDetail() {
  const { kind = "", ns = "_", name = "" } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { cluster: effectiveCluster } = useCluster();

  const def = lookupDef(kind, sp);
  const namespace = ns === "_" ? "" : ns;

  function goBack() {
    navigate(-1);
  }

  if (!def) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Unknown resource kind "{kind}".</p>
          <button className="kb-btn" onClick={goBack}>Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="resource-detail-page">
      <div className="resource-detail-back">
        <button className="resource-detail-back-btn" onClick={goBack} aria-label="Back">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to {def.label}
        </button>
      </div>

      {/* Render GenericDrawer in full-page mode by overriding its aside/drawer styles */}
      <div className="resource-detail-content">
        <GenericDrawer
          cluster={effectiveCluster}
          def={def}
          ns={namespace}
          name={name}
          onClose={goBack}
        />
      </div>
    </div>
  );
}
