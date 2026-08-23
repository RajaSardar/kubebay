import { useEffect, useState } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { api, nodeApi } from "../lib/api";
import { YamlTab } from "./YamlTab";
import { ExecTerm } from "./ExecTerm";
import { ActionsBar } from "./ActionsBar";
import type { ResourceDef } from "../lib/resources";

export default function GenericDrawer({
  cluster,
  def,
  ns,
  name,
  onClose,
}: {
  cluster: string;
  def: ResourceDef;
  ns: string;
  name: string;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isNode = def.slug === "nodes";
  const [nodeTab, setNodeTab] = useState<"yaml" | "shell">("shell");
  const [creating, setCreating] = useState(false);
  const [shellPod, setShellPod] = useState<{ ns: string; pod: string } | null>(null);
  const [shellErr, setShellErr] = useState("");

  async function startShell() {
    setCreating(true);
    setShellErr("");
    try {
      const r = await nodeApi.shellStart({ cluster, node: name });
      setShellPod({ ns: r.namespace, pod: r.pod });
    } catch (e) {
      setShellErr(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    return () => {
      if (shellPod) {
        void api
          .deleteResource({ cluster, gvr: "v1/pods", ns: shellPod.ns, name: shellPod.pod })
          .catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConfirming(false);
    setInput("");
    setErr("");
  }, [name, ns]);

  async function doDelete() {
    if (input !== name) {
      setErr("Name does not match.");
      return;
    }
    setDeleting(true);
    try {
      await api.deleteResource({ cluster, gvr: def.gvr, ns, name });
      onClose();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <StatusDot status="connected" />
        <div style={{ minWidth: 0 }}>
          <div className="mono strong">{name}</div>
          <div className="muted small mono">{def.scoped ? def.label : ns}</div>
        </div>
        <div className="drawer-head-actions">
          {!confirming ? (
            <>
              <Button variant="ghost" className="kb-btn-danger-ghost" onClick={() => setConfirming(true)}>
                Delete
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Badge tone="err">type name to confirm</Badge>
              <input
                className="toolbar-input"
                style={{ maxWidth: 180 }}
                placeholder={name}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
              />
              <Button variant="danger" disabled={deleting} onClick={() => void doDelete()}>
                Confirm
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setInput("");
                  setErr("");
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
      {err && (
        <div className="error-banner" style={{ margin: "10px 14px 0" }}>
          {err}
        </div>
      )}
      {["deployments", "statefulsets", "daemonsets", "cronjobs", "nodes"].includes(def.slug) && (
        <ActionsBar slug={def.slug as "deployments"} cluster={cluster} ns={ns} name={name} />
      )}

      {isNode && (
        <div className="tabs">
          {(["shell", "yaml"] as const).map((t) => (
            <button key={t} className={`tab${nodeTab === t ? " active" : ""}`} onClick={() => setNodeTab(t)}>
              {t === "shell" ? "Terminal" : "YAML"}
            </button>
          ))}
        </div>
      )}

      {isNode && nodeTab === "shell" ? (
        shellPod ? (
          <div className="term-wrap">
            <ExecTerm cluster={cluster} namespace={shellPod.ns} pod={shellPod.pod} container="shell" shell="sh" />
          </div>
        ) : (
          <div className="page" style={{ paddingTop: 24 }}>
            {shellErr && <div className="error-banner">{shellErr}</div>}
            <p className="muted small" style={{ marginTop: 0 }}>
              Starts a short-lived privileged helper pod (busybox + hostPID) pinned to{" "}
              <span className="mono">{name}</span>, giving you a root shell on the node.
              It is deleted automatically when this panel closes.
            </p>
            <Button disabled={creating} onClick={() => void startShell()}>
              {creating ? "Creating…" : "Start node shell"}
            </Button>
          </div>
        )
      ) : (
        <div className="yaml-wrap">
          <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
        </div>
      )}
    </aside>
  );
}
