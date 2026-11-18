import { useSearchParams } from "react-router-dom";
import { NewResourceEditor } from "../components/NewResourceEditor";
import { useActiveCluster } from "../App";

// The editor itself is shared with the dock's "New resource" tab (backlog 51 phase 4).
export default function CreateResource() {
  const { active } = useActiveCluster();
  // A table's "+" button opens this page on its own kind: /create-resource?kind=Deployment.
  const [sp] = useSearchParams();
  return (
    <NewResourceEditor
      cluster={active ?? null}
      guardKey="create-resource"
      variant="page"
      initialKind={sp.get("kind") ?? undefined}
    />
  );
}
