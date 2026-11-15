import { Badge, Button, Card, DataTable, InlineBanner, Row, Stack } from "@kubebay/ui";
import type { ExtAction, ExtColumn } from "../lib/api";
import { useExtensionsFile } from "../lib/useExtensions";

type Entry = { kind: "Column"; c: ExtColumn } | { kind: "Link" | "Command"; a: ExtAction };

const STARTER = `columns:
  - resource: pods
    header: Host IP
    jsonPath: .status.hostIP
actions:
  - resource: deployments
    label: Tail logs with stern
    run: "stern -n {{namespace}} {{name}}"`;

/**
 * KB-13: where ~/.kubebay/extensions.yaml is, what Kubebay loaded from it, and
 * what's wrong with the rest. Kubebay only reads the file.
 */
export function ExtensionsCard() {
  const q = useExtensionsFile();
  const f = q.data;
  if (!f) return null;

  const entries: Entry[] = [
    ...f.columns.map((c): Entry => ({ kind: "Column", c })),
    ...f.actions.map((a): Entry => ({ kind: a.url !== undefined ? "Link" : "Command", a })),
  ];
  const loaded = f.columns.length + f.actions.length;

  return (
    <Card id="extensions" style={{ marginTop: 18 }}>
      <Row align="center" gap={2}>
        <div className="rbac-section-title">Extensions</div>
        {loaded > 0 && <Badge>{loaded} loaded</Badge>}
        {f.errors.length > 0 && <Badge tone="warn">{f.errors.length} with errors</Badge>}
      </Row>
      <Stack gap={3}>
        <div className="muted small">
          Add your own table columns and row actions in a YAML file. A link opens in your browser with the row&apos;s
          values in it. A command is typed into a local shell for you to read and run. Kubebay only reads the file,
          and never downloads one.
        </div>
        {f.disabled ? (
          <InlineBanner tone="warn" flush>
            Extensions aren&apos;t available here: {f.disabled}.
          </InlineBanner>
        ) : (
          <>
            <Row gap={2} align="center" wrap>
              <span className="mono small">{f.path}</span>
              <Button variant="ghost" disabled={q.isFetching} onClick={() => void q.refetch()}>
                Reload
              </Button>
            </Row>
            {f.errors.length > 0 && (
              <InlineBanner flush>
                <Stack gap={1}>
                  <span>Kubebay skipped these entries:</span>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {f.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Stack>
              </InlineBanner>
            )}
            {!f.exists ? (
              <Stack gap={1}>
                <div className="small">No extensions file yet. Create it with entries like these:</div>
                <pre className="mono small" style={{ margin: 0, padding: 8, background: "var(--kb-bg-inset)", borderRadius: "var(--kb-radius-xs)", overflow: "auto" }}>
                  {STARTER}
                </pre>
              </Stack>
            ) : (
              entries.length > 0 && (
                <DataTable
                  rows={entries}
                  rowKey={(e, i) => `${e.kind}-${i}`}
                  columns={[
                    { key: "kind", header: "Type", width: 100, className: "small", render: (e) => e.kind },
                    { key: "resource", header: "Resource", width: 180, className: "mono small", render: (e) => (e.kind === "Column" ? e.c.resource : e.a.resource) },
                    { key: "name", header: "Name", width: 180, className: "small strong", render: (e) => (e.kind === "Column" ? e.c.header : e.a.label) },
                    {
                      key: "what",
                      header: "Reads or does",
                      className: "mono muted small",
                      render: (e) => (e.kind === "Column" ? e.c.jsonPath : (e.a.url ?? e.a.run ?? "")),
                    },
                  ]}
                />
              )
            )}
            <div className="muted small">
              {f.commands.available
                ? `Command actions are typed into the local shell (${f.commands.shell ?? "your shell"}), with each value quoted. They never run until you press Enter.`
                : `Command actions are hidden: ${f.commands.reason ?? "there's no local shell"}.`}
            </div>
          </>
        )}
      </Stack>
    </Card>
  );
}
