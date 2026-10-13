import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import { Button, DataTable, EmptyState, IconButton, InlineBanner, Modal, Row, Stack, TextField, Card } from "@kubebay/ui";
import { applyView, captureView, exportViews, parseViewsFile, useSavedViews } from "../lib/savedViews";
import { connectCluster } from "../lib/clusterConnections";

/**
 * KB-16: save the table you're looking at (cluster, kind, namespaces,
 * filter, columns, sort) under a name. Views open from the sidebar and ⌘K,
 * and travel as a file through Settings.
 */
export function SaveViewButton(p: { cluster: string; kind: string; namespaces: string[]; filter: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = useSavedViews((s) => s.add);
  const save = () => {
    if (!name.trim()) return;
    add(captureView({ name: name.trim(), cluster: p.cluster, kind: p.kind, namespaces: p.namespaces, filter: p.filter }));
    setOpen(false);
    setName("");
  };
  return (
    <>
      <Button variant="ghost" disabled={!p.cluster} onClick={() => setOpen(true)}>
        Save view
      </Button>
      {open && (
        <Modal label="Save view" title="Save view" placement="center" onClose={() => setOpen(false)}>
          <Stack gap={3}>
            <div className="muted small">
              Saves {p.label} on <span className="mono">{p.cluster}</span>
              {p.namespaces.length ? ` in ${p.namespaces.join(", ")}` : " in all namespaces"}
              {p.filter ? (
                <>
                  , filtered by <span className="mono">{p.filter}</span>
                </>
              ) : null}
              , with this table&apos;s columns and sort.
            </div>
            <TextField
              aria-label="View name"
              placeholder="e.g. Crashing shop pods"
              value={name}
              autoFocus
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            <Row gap={2}>
              <Button disabled={!name.trim()} onClick={save}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </Row>
          </Stack>
        </Modal>
      )}
    </>
  );
}

export function SavedViewsSidebar() {
  const views = useSavedViews((s) => s.views);
  const remove = useSavedViews((s) => s.remove);
  if (!views.length) return null;
  return (
    <div className="favorites-sidebar">
      <div className="favorites-header">
        <span className="nav-section">Saved views</span>
      </div>
      <div className="favorites-list">
        {views.map((v) => (
          <div key={v.id} className="favorites-item" title={`${v.kind} · ${v.cluster}${v.filter ? ` · ${v.filter}` : ""}`}>
            <NavLink to={`/view/${v.id}`} className={({ isActive }) => (isActive ? "favorites-link active" : "favorites-link")}>
              {v.name}
            </NavLink>
            <IconButton
              label={`Remove view ${v.name}`}
              className="favorites-remove"
              onClick={(e) => {
                e.preventDefault();
                remove(v.id);
              }}
            >
              ×
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

/** /view/:id: make the view current, then open its table. */
export function OpenSavedView() {
  const { id = "" } = useParams();
  const view = useSavedViews((s) => s.views.find((v) => v.id === id));
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    if (!view) return;
    connectCluster(view.cluster);
    setTo(applyView(view));
  }, [view]);
  if (!view) {
    return (
      <div className="page">
        <EmptyState title="That saved view no longer exists." hint="Saved views are listed in the sidebar and in Settings." />
      </div>
    );
  }
  return to ? <Navigate to={to} replace /> : null;
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function SavedViewsCard() {
  const views = useSavedViews((s) => s.views);
  const remove = useSavedViews((s) => s.remove);
  const importViews = useSavedViews((s) => s.importViews);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseViewsFile(await file.text());
    if ("error" in parsed) {
      setMsg({ tone: "err", text: parsed.error });
    } else {
      const { added, replaced } = importViews(parsed.views);
      const n = (k: number) => `${k} view${k === 1 ? "" : "s"}`;
      setMsg({ tone: "ok", text: `Imported ${n(added)}${replaced ? `, replaced ${n(replaced)}` : ""}.` });
    }
    if (input.current) input.current.value = "";
  };

  return (
    <Card id="saved-views" style={{ marginTop: 18 }}>
      <div className="rbac-section-title">Saved views</div>
      <Stack gap={3}>
        <div className="muted small">
          A saved view is a resource table as you left it: cluster, kind, namespaces, filter, columns and sort. Save one
          from any table&apos;s header, and open it from the sidebar or ⌘K. Export them to a file to share through git; an
          import replaces views with the same name, cluster and kind.
        </div>
        <DataTable
          rows={views}
          rowKey={(v) => v.id}
          empty={<EmptyState title="No saved views yet." hint="Use Save view on a resource table." />}
          columns={[
            { key: "name", header: "Name", className: "small strong", render: (v) => v.name },
            { key: "what", header: "Table", className: "mono small", render: (v) => `${v.kind} · ${v.cluster}` },
            { key: "ns", header: "Namespaces", className: "mono small", render: (v) => (v.namespaces.length ? v.namespaces.join(", ") : "all") },
            { key: "filter", header: "Filter", className: "mono small", render: (v) => v.filter || "–" },
            {
              key: "actions",
              header: "",
              render: (v) => (
                <Button variant="danger-ghost" onClick={() => remove(v.id)}>
                  Delete
                </Button>
              ),
            },
          ]}
        />
        {msg && (
          <InlineBanner tone={msg.tone === "ok" ? "ok" : "err"} flush>
            {msg.text}
          </InlineBanner>
        )}
        <Row gap={2} align="center" wrap>
          <Button variant="ghost" disabled={!views.length} onClick={() => download("kubebay-views.json", exportViews(views))}>
            Export
          </Button>
          <Button variant="ghost" onClick={() => input.current?.click()}>
            Import…
          </Button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            aria-label="Import saved views"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </Row>
      </Stack>
    </Card>
  );
}
