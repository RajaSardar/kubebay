import { Badge, Row, Stack, StatusPill } from "@kubebay/ui";
import type { ReleaseReplicaSet, ReleaseService, ReleaseStep, ReleaseView } from "../lib/rolloutRelease";

function stepTone(s: ReleaseStep) {
  if (s.note === "aborted") return "err" as const;
  if (s.paused) return "warn" as const;
  return s.state === "done" ? ("ok" as const) : s.state === "current" ? ("pending" as const) : ("terminated" as const);
}

function Steps({ steps }: { steps: ReleaseStep[] }) {
  return (
    <Stack gap={1} as="ol" aria-label="Release steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s) => (
        <li key={s.index} aria-current={s.state === "current" ? "step" : undefined}>
          <Row gap={2} align="center" wrap>
            <StatusPill tone={stepTone(s)}>{s.note === "aborted" ? "aborted" : s.paused ? "paused" : s.state}</StatusPill>
            <span className={s.state === "current" ? "small strong" : "small"}>{s.label}</span>
            {s.pauseReason && <span className="muted small">{s.pauseReason}</span>}
          </Row>
        </li>
      ))}
    </Stack>
  );
}

function weightText(r: ReleaseReplicaSet): string {
  if (r.weight === null) return "";
  return `${r.weight}% ${r.weightKind === "live" ? "live" : "target"}`;
}

function ReplicaSets({ sets }: { sets: ReleaseReplicaSet[] }) {
  if (sets.length === 0) return <span className="muted small">No ReplicaSets owned by this Rollout in the loaded namespaces.</span>;
  return (
    <Stack gap={1}>
      {sets.map((r) => (
        <Row key={r.name} gap={2} align="center" wrap>
          <Badge>{r.role}</Badge>
          <span className="mono small">{r.name}</span>
          <span className="muted small">{`rev ${r.revision || "?"}`}</span>
          <span className="mono small">{r.images.join(", ")}</span>
          <span className="small">{`${r.ready}/${r.desired} ready`}</span>
          {r.weight !== null && <span className="small">{weightText(r)}</span>}
        </Row>
      ))}
    </Stack>
  );
}

function Services({ services, available }: { services: ReleaseService[]; available: boolean }) {
  if (services.length === 0) return null;
  return (
    <Stack gap={1}>
      <span className="muted small">Services</span>
      {!available && <span className="muted small">Services are not available to you here, so only their names are shown.</span>}
      {services.map((s) => (
        <Row key={s.role} gap={2} align="center" wrap>
          <Badge>{s.role}</Badge>
          <span className="mono small">{s.name}</span>
          {s.found === false && <span className="small">not found</span>}
          {s.selectsRevision && <span className="muted small">{`selects rev ${s.selectsRevision}`}</span>}
        </Row>
      ))}
    </Stack>
  );
}

/**
 * The release view of one Rollout, built by buildReleaseView: strategy,
 * steps, stable and canary ReplicaSets, Services, AnalysisRun metrics,
 * conditions and why it is halted. Display only: the actions stay in the
 * Rollouts page's own row. Status text is rendered as plain text nodes.
 */
export function RolloutRelease({ view }: { view: ReleaseView }) {
  return (
    <Stack gap={3} aria-label="Release">
      <Row gap={2} align="center" wrap>
        <StatusPill tone={view.tone}>{view.phase}</StatusPill>
        {view.strategy !== "unknown" && <Badge>{view.strategy}</Badge>}
        {view.message && <span className="small">{view.message}</span>}
      </Row>
      {view.haltReason && <span className="small strong">{view.haltReason}</span>}
      {view.steps.length > 0 && <Steps steps={view.steps} />}
      <ReplicaSets sets={view.replicaSets} />
      <Services services={view.services} available={view.servicesAvailable} />
      {view.analyses.length > 0 && (
        <Stack gap={2}>
          <span className="muted small">Analysis</span>
          {view.analyses.map((a) => (
            <Stack key={a.name} gap={1}>
              <Row gap={2} align="center" wrap>
                <span className="mono small">{a.name}</span>
                <StatusPill tone={a.tone}>{a.phase}</StatusPill>
                {a.message && <span className="small">{a.message}</span>}
              </Row>
              {a.metrics.map((m) => (
                <Row key={m.name} gap={2} align="center" wrap>
                  <span className="mono small">{m.name}</span>
                  <StatusPill tone={m.tone}>{m.phase}</StatusPill>
                  <span className="muted small">{m.summary}</span>
                  {m.lastValue && <span className="small">{`last ${m.lastValue}`}</span>}
                  {m.failure && <span className="small">{m.failure}</span>}
                </Row>
              ))}
            </Stack>
          ))}
        </Stack>
      )}
      {view.conditions.length > 0 && (
        <Stack gap={1}>
          <span className="muted small">Conditions</span>
          {view.conditions.map((c) => (
            <Row key={c.type} gap={2} align="center" wrap>
              <StatusPill tone={c.tone}>{`${c.type}: ${c.status}`}</StatusPill>
              {c.reason && <span className="mono small">{c.reason}</span>}
              {c.message && <span className="small">{c.message}</span>}
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
