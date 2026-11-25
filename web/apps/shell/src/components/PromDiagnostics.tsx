import { useMutation } from "@tanstack/react-query";
import { Button, InlineBanner, Row, Stack } from "@kubebay/ui";
import { promApi, type PromStatus, type PromTestResult } from "../lib/api";

/** Runs the engine's read-only connection test and shows each query's URL and HTTP status. */
export function PromTestPanel({ cluster, target }: { cluster: string; target?: string }) {
  const test = useMutation<PromTestResult, Error>({ mutationFn: () => promApi.test(cluster, target) });
  const r = test.data;
  return (
    <Stack gap={2}>
      <Row gap={2} align="center">
        <Button type="button" variant="ghost" disabled={test.isPending} onClick={() => test.mutate()}>
          Test connection
        </Button>
        {test.isPending && <span className="muted small">Testing…</span>}
      </Row>
      {test.isError && (
        <InlineBanner flush>Could not run the test: {test.error.message}</InlineBanner>
      )}
      {r && (
        <InlineBanner flush tone={r.ok ? "ok" : "err"}>
          <Stack gap={1}>
            <span>{r.message}</span>
            {r.target && <span className="small mono">Using {r.source}: {r.target}</span>}
            {r.checks.map((c) => (
              <span key={c.query} className="small">
                <span className="mono">{c.query}</span>
                {" · "}
                {c.httpStatus ? `HTTP ${c.httpStatus}` : "no HTTP answer"}
                {c.httpStatus ? ` · ${c.series} series` : ""}
                {c.error ? ` · ${c.error}` : ""}
                <br />
                <span className="mono">{c.url}</span>
              </span>
            ))}
          </Stack>
        </InlineBanner>
      )}
    </Stack>
  );
}

/** Prometheus was not found: says where Kubebay looked, what it was refused, and how to fix it. */
export function PromNotFound({
  cluster,
  status,
  onChoose,
  onEnterUrl,
  locked = false,
}: {
  cluster: string;
  status?: PromStatus;
  /** A shared engine: the operator sets Prometheus, so there is nothing to choose here. */
  locked?: boolean;
  onChoose: () => void;
  onEnterUrl: () => void;
}) {
  const tried = status?.tried ?? [];
  const forbidden = status?.forbidden ?? [];
  return (
    <Stack gap={2}>
      <strong>Prometheus: not found.</strong>
      {status?.scope === "cluster" ? (
        <span className="small muted">Kubebay looked at every Service in the cluster and none looks like a Prometheus.</span>
      ) : tried.length > 0 ? (
        <span className="small muted">Tried: {tried.join(", ")}.</span>
      ) : null}
      {forbidden.length > 0 && (
        <span className="small muted">Not allowed to list Services in: {forbidden.join(", ")}.</span>
      )}
      {status?.error && <span className="small muted">{status.error}</span>}
      {locked ? (
        <span className="small muted">Prometheus is set by whoever runs this Kubebay. Ask them to point it at one.</span>
      ) : (
        <>
          <span className="small muted">Set one:</span>
          <Row gap={2}>
            <Button type="button" onClick={onChoose}>Choose a Service</Button>
            <Button type="button" variant="ghost" onClick={onEnterUrl}>Enter URL</Button>
          </Row>
        </>
      )}
      <PromTestPanel cluster={cluster} />
    </Stack>
  );
}
