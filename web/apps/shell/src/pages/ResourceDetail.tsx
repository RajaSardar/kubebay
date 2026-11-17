import { Navigate, useParams } from "react-router-dom";
import ResourceTable from "./ResourceTable";

/**
 * Deep link to one object (bookmarks, cross-links, the palette). Every kind
 * opens the way a pod does: the kind's list with the object's drawer on the
 * right. There is no full-page variant.
 */
export default function ResourceDetail() {
  const { kind = "", ns = "_", name = "" } = useParams();
  // Pods have their own list and panel.
  if (kind === "pods") return <Navigate to={`/workloads?pod=${encodeURIComponent(`${ns === "_" ? "" : ns}/${name}`)}`} replace />;
  return <ResourceTable />;
}
