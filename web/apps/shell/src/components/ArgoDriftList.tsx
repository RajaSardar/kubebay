import { Link } from "react-router-dom";
import { Badge } from "@kubebay/ui";
import type { ArgoCDResource } from "../lib/api";
import { sortResourcesByDrift } from "../lib/argoDrift";
import { slugForKind } from "../lib/resources";

/**
 * The per-Application drift list backlog #12 settled on shipping: no
 * line-level diff (that needs argocd-server's REST API + a token — a
 * credential story Kubebay deliberately doesn't have), just the per-object
 * sync/health breakdown that's already free on the k8s API. A resource
 * links to its own detail page only when its Kind maps to a route Kubebay
 * actually has — never a guessed link.
 */
export function ArgoDriftList({ resources }: { resources: ArgoCDResource[] }) {
  if (resources.every((r) => r.status !== "OutOfSync")) {
    return <div className="muted small">All resources in sync.</div>;
  }

  const sorted = sortResourcesByDrift(resources);

  return (
    <div className="table-wrap">
      <table className="kb-table">
        <thead>
          <tr><th>Kind</th><th>Namespace</th><th>Name</th><th>Status</th><th>Health</th></tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const slug = slugForKind(r.kind);
            return (
              <tr key={i}>
                <td className="mono small">{r.kind}</td>
                <td className="mono small">{r.namespace || "–"}</td>
                <td className="mono small strong">
                  {slug ? <Link to={`/detail/${slug}/${r.namespace || "_"}/${r.name}`}>{r.name}</Link> : r.name}
                </td>
                <td>
                  <Badge tone={r.status === "OutOfSync" ? "err" : "ok"}>{r.status}</Badge>
                </td>
                <td className="small">{r.health || "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
