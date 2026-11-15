import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Row, Stack, TextField } from "@kubebay/ui";
import { settingsApi } from "../lib/api";

/**
 * The kubeconfig files Kubebay reads clusters from: the ones loaded now, extra
 * files to merge in, and whether to read only the listed files. Lives on the
 * cluster list (its "Add kubeconfig" dialog), where the clusters are.
 */
export function KubeconfigSources() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const extras = settings.data?.extraKubeconfigs ?? [];
  const active = settings.data?.activeKubeconfigs ?? [];
  const isolated = settings.data?.onlyListedKubeconfigs ?? false;

  async function persist(next: string[], onlyListed?: boolean) {
    setErr("");
    setMsg("");
    try {
      // Spread the current settings: the engine saves the body as given, so a
      // field left out (the node-shell image, Prometheus URLs) would be wiped.
      const cur = await settingsApi.get();
      await settingsApi.save({ ...cur, extraKubeconfigs: next, onlyListedKubeconfigs: onlyListed ?? isolated });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["clusters"] });
      setMsg("Saved — clusters reloading.");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <Stack gap={3}>

      {/* Active files being loaded */}
      {active.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="muted small" style={{ marginBottom: 6 }}>Active kubeconfig files (currently loaded):</p>
          {active.map((p) => (
            <div key={p} className="rbac-subject" style={{ marginBottom: 4 }}>
              <span style={{ fontSize: "var(--kb-text-2xs)", fontFamily: "var(--kb-font-mono)", background: "var(--kb-status-ok-subtle)", color: "var(--kb-status-ok-fg)", padding: "1px 6px", borderRadius: "var(--kb-radius-xs)", marginRight: 8, flexShrink: 0 }}>active</span>
              <span className="mono small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* Extra kubeconfig files */}
      {extras.map((p) => (
        <div key={p} className="rbac-subject" style={{ marginBottom: 6 }}>
          <span className="mono small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p}</span>
          <Button
            variant="danger-ghost"
            onClick={() => void persist(extras.filter((x) => x !== p))}
          >
            Remove
          </Button>
        </div>
      ))}

      <div className="rbac-subject" style={{ marginBottom: 6 }}>
        <label className="ctl" style={{ cursor: "pointer", flex: 1 }}>
          <input
            type="checkbox"
            checked={isolated}
            onChange={(e) => void persist(extras, e.target.checked)}
          />
          Use only the files listed above (ignore default ~/.kube/config and KUBECONFIG)
        </label>
      </div>
      {!extras.length && <p className="muted small">Default kubeconfig is loaded automatically. Add extra files below to merge additional clusters.</p>}
      <Row gap={2} align="center">
        <TextField
          aria-label="Kubeconfig file path"
          placeholder="/path/to/another/kubeconfig"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button
          disabled={!draft.trim()}
          onClick={() => {
            void persist([...extras, draft.trim()]).then(() => setDraft(""));
          }}
        >
          Add file
        </Button>
      </Row>
      {(msg || err) && (
        <p className={`small ${err ? "error-text" : "muted"}`} style={{ marginBottom: 0 }}>
          {err || msg}
        </p>
      )}
    </Stack>
  );
}
