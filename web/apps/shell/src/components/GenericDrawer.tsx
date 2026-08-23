import { useEffect, useState } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { YamlTab } from "./YamlTab";
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
      <div className="yaml-wrap">
        <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
      </div>
    </aside>
  );
}
