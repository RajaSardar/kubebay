import { Link } from "react-router-dom";
import { Badge, DataTable } from "@kubebay/ui";
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
    <DataTable
      rows={sorted}
      rowKey={(r, i) => `${r.kind}/${r.namespace}/${r.name}/${i}`}
      columns={[
        { key: "kind", header: "Kind", className: "mono small", render: (r) => r.kind },
        { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.namespace || "–" },
        {
          key: "name",
          header: "Name",
          className: "mono small strong",
          render: (r) => {
            const slug = slugForKind(r.kind);
            return slug ? <Link to={`/detail/${slug}/${r.namespace || "_"}/${r.name}`}>{r.name}</Link> : r.name;
          },
        },
        {
          key: "status",
          header: "Status",
          render: (r) => <Badge tone={r.status === "OutOfSync" ? "err" : "ok"}>{r.status}</Badge>,
        },
        { key: "health", header: "Health", className: "small", render: (r) => r.health || "–" },
      ]}
    />
  );
}
