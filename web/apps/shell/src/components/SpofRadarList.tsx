import { useState } from "react";
import { Badge, Button, Card, EmptyState, Row, Stack } from "@kubebay/ui";
import { ResourceLink } from "./ResourceLink";
import { slugForKind } from "../lib/resources";
import type { SpofFinding, SpofKind } from "../lib/spof";

type Filter = "all" | SpofKind;

const KIND_LABEL: Record<SpofKind, string> = {
  "no-pdb": "No PDB",
  "no-spread": "Clustered",
  "single-backend": "Single backend",
};

/**
 * Backlog #24: pure-rendering half of SPOF Radar. Mirrors KedaInventory's
 * "All / <kind> / <kind>" filter-button pattern. Each finding links to its
 * own resource via slugForKind -- Deployment/StatefulSet/Service are all
 * built-in DEFS kinds, so this never needs the CRD ext-- slug indirection
 * KEDA's fleet page had to handle.
 */
export function SpofRadarList({ findings }: { findings: SpofFinding[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  if (findings.length === 0) {
    return (
      <EmptyState>
        <p>No single points of failure detected.</p>
      </EmptyState>
    );
  }

  const counts: Record<SpofKind, number> = { "no-pdb": 0, "no-spread": 0, "single-backend": 0 };
  for (const f of findings) counts[f.kind]++;

  const filtered = filter === "all" ? findings : findings.filter((f) => f.kind === filter);

  return (
    <Stack gap={3}>
      <Row gap={2} wrap>
        <Button variant={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>
          All ({findings.length})
        </Button>
        {(Object.keys(KIND_LABEL) as SpofKind[]).map((kind) => (
          <Button key={kind} variant={filter === kind ? "primary" : "ghost"} onClick={() => setFilter(kind)}>
            {KIND_LABEL[kind]} ({counts[kind]})
          </Button>
        ))}
      </Row>

      {filtered.length === 0 ? (
        <EmptyState>
          <p>No findings match this filter.</p>
        </EmptyState>
      ) : (
        <Stack gap={2}>
          {filtered.map((f, i) => {
            const slug = slugForKind(f.workloadKind);
            return (
              <Card key={`${f.ns}/${f.name}/${f.kind}/${i}`}>
                <Row align="center" gap={2} wrap>
                  <Badge tone="err">{KIND_LABEL[f.kind]}</Badge>
                  {slug ? (
                    <ResourceLink kind={slug} ns={f.ns} name={f.name}>
                      <span className="mono strong small">{f.name}</span>
                    </ResourceLink>
                  ) : (
                    <span className="mono strong small">{f.name}</span>
                  )}
                  <span className="muted small">{f.ns}</span>
                </Row>
                <div className="small" style={{ marginTop: 8 }}>{f.detail}</div>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
