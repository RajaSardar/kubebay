import { Badge } from "@kubebay/ui";
import type { ControlRef } from "../lib/controlIds";

/** Framework control IDs for a finding (lib/controlIds.ts); the control's name is in the tooltip. */
export function ControlTags({ controls }: { controls: ControlRef[] }) {
  if (controls.length === 0) return null;
  return (
    <>
      {controls.map((c) => (
        <Badge key={`${c.framework} ${c.id}`} tone="info" title={`${c.framework === "CIS" ? "CIS Kubernetes Benchmark" : "MITRE ATT&CK"} ${c.id}: ${c.name}`}>
          {`${c.framework} ${c.id}`}
        </Badge>
      ))}
    </>
  );
}
