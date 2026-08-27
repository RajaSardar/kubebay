import { useEffect, useState } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { api, nodeApi } from "../lib/api";
import { YamlTab } from "./YamlTab";
import { EventsDrawer } from "./EventsDrawer";
import { ExecTerm } from "./ExecTerm";
import { ActionsBar } from "./ActionsBar";
import { NodeSummary } from "./NodeSummary";
import { ServiceSummary } from "./ServiceSummary";
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
  const [force, setForce] = useState(false);

  const isNode = def.slug === "nodes";
  const [nodeTab, setNodeTab] = useState<"summary" | "shell" | "yaml">("summary");
  const [svcTab, setSvcTab] = useState<"summary" | "yaml">("summary");
  const [genTab, setGenTab] = useState<"yaml" | "events">("yaml");
  const [obj, setObj] = useState<Record<string, unknown> | null>(null);
  const [objLoading, setObjLoading] = useState(false);
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

  const isService = def.slug === "services";

  useEffect(() => {
    if (!isNode && !isService) return;
    setObjLoading(true);
    api.getYamlText(cluster, def.gvr, ns, name).then((text) => {
      try {
        setObj(JSON.parse(text));
      } catch {
        setObj(null);
      }
    }).catch(() => setObj(null)).finally(() => setObjLoading(false));
  }, [cluster, def.gvr, ns, name, isNode, isService]);

  async function doDelete() {
    if (input !== name) {
      setErr("Name does not match.");
      return;
    }
    setDeleting(true);
    try {
      await api.deleteResource({
        cluster,
        gvr: def.gvr,
        ns,
        name,
        graceSeconds: force ? 0 : undefined,
        forceFinalizers: force,
      });
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
              <label className="ctl" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                force
              </label>
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
          {(["summary", "shell", "yaml"] as const).map((t) => (
            <button key={t} className={`tab${nodeTab === t ? " active" : ""}`} onClick={() => setNodeTab(t)}>
              {t === "summary" ? "Summary" : t === "shell" ? "Terminal" : "YAML"}
            </button>
          ))}
        </div>
      )}

      {isService && (
        <div className="tabs">
          {(["summary", "yaml"] as const).map((t) => (
            <button key={t} className={`tab${svcTab === t ? " active" : ""}`} onClick={() => setSvcTab(t)}>
              {t === "summary" ? "Summary" : "YAML"}
            </button>
          ))}
        </div>
      )}

      {!isNode && !isService && (
        <div className="tabs">
          {(["yaml", "events"] as const).map((t) => (
            <button key={t} className={`tab${genTab === t ? " active" : ""}`} onClick={() => setGenTab(t)}>
              {t === "yaml" ? "YAML" : "Events"}
            </button>
          ))}
        </div>
      )}

      {isService && svcTab === "summary" ? (
        objLoading ? (
          <div className="muted small" style={{ padding: 14 }}>Loading…</div>
        ) : obj ? (
          <ServiceSummary obj={obj} />
        ) : (
          <div className="muted small" style={{ padding: 14 }}>Could not load service data.</div>
        )
      ) : isNode && nodeTab === "summary" ? (
        objLoading ? (
          <div className="muted small" style={{ padding: 14 }}>Loading…</div>
        ) : obj ? (
          <NodeSummary obj={obj} />
        ) : (
          <div className="muted small" style={{ padding: 14 }}>Could not load node data.</div>
        )
      ) : isNode && nodeTab === "shell" ? (
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
      ) : isNode && nodeTab === "yaml" ? (
        <div className="yaml-wrap">
          <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
        </div>
      ) : isService && svcTab === "yaml" ? (
        <div className="yaml-wrap">
          <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
        </div>
      ) : !isNode && !isService && genTab === "yaml" ? (
        <div className="yaml-wrap">
          <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
        </div>
      ) : !isNode && !isService && genTab === "events" ? (
        <div style={{ padding: 14 }}>
          <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={def.label} />
        </div>
      ) : null}
    </aside>
  );
}
