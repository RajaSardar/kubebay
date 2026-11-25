import { useEffect, useMemo, useState } from "react";
import { Badge, Button, InlineBanner, Modal, Row, Select, SkeletonLines, Stack, TextField } from "@kubebay/ui";
import { api } from "../lib/api";
import { getConnectedClusters } from "../lib/clusterConnections";
import {
  compareErrorMessage,
  normalizeObject,
  refFromObject,
  refLabel,
  sameRef,
  toYaml,
  unifiedDiff,
  type CompareRef,
} from "../lib/compare";
import { useCompare } from "../lib/compare-store";
import { DiffEditor } from "../lib/monaco";
import { useMonacoTheme } from "../lib/theme";
import { useObjectPicker } from "../lib/useObjectPicker";

type Side = { state: "loading" } | { state: "ok"; obj: Record<string, unknown> } | { state: "error"; message: string };

const isSecret = (r: CompareRef | null) => r?.gvr === "v1/secrets";

/** Fetches one side with the signed-in user's own access; a failure becomes a message, never a throw. */
function useSide(ref: CompareRef | null): Side | null {
  const [side, setSide] = useState<Side | null>(null);
  const key = ref ? `${ref.cluster}|${ref.gvr}|${ref.ns}|${ref.name}` : "";
  useEffect(() => {
    if (!ref) {
      setSide(null);
      return;
    }
    let live = true;
    setSide({ state: "loading" });
    api
      .getObjectForCompare(ref.cluster, ref.gvr, ref.ns, ref.name)
      .then((obj) => live && setSide({ state: "ok", obj }))
      .catch((e: unknown) => live && setSide({ state: "error", message: compareErrorMessage(e, ref) }));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return side;
}

/** Pick any object of any kind on any connected cluster. */
function Picker({ title, initialCluster, onPick }: { title: string; initialCluster: string; onPick: (r: CompareRef) => void }) {
  const clusters = useMemo(() => [...getConnectedClusters()].sort(), []);
  const [cluster, setCluster] = useState(initialCluster || clusters[0] || "");
  const [q, setQ] = useState("");
  const { groups, loading, error } = useObjectPicker(cluster, q);
  const options = clusters.includes(cluster) || !cluster ? clusters : [cluster, ...clusters];
  return (
    <Stack gap={2}>
      <strong>{title}</strong>
      <Row gap={2}>
        <Select aria-label={`${title} cluster`} value={cluster} onChange={(e) => setCluster(e.target.value)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <TextField
          aria-label={`${title} search`}
          placeholder="Search by name, or kind and name (deploy api)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          style={{ flex: 1 }}
        />
      </Row>
      {error && <InlineBanner flush>{error}</InlineBanner>}
      {q.trim() && !loading && groups.length === 0 && !error && <span className="muted small">Nothing matches.</span>}
      {loading && <span className="muted small">Searching…</span>}
      {groups.map((g) => (
        <Stack key={g.slug} gap={1}>
          <span className="muted small">{g.label}</span>
          {g.hits.map((h) => {
            const ref = refFromObject(h.obj);
            if (!ref) return null;
            return (
              <Button key={`${h.obj.ns}/${h.obj.name}`} variant="ghost" onClick={() => onPick(ref)}>
                {h.obj.ns ? `${h.obj.ns}/` : ""}
                {h.obj.name}
              </Button>
            );
          })}
        </Stack>
      ))}
    </Stack>
  );
}

function SideHeader({ title, r, onChange }: { title: string; r: CompareRef; onChange: () => void }) {
  return (
    <Row gap={2} align="center">
      <span className="muted small">{title}</span>
      <strong className="mono">{refLabel(r)}</strong>
      {r.kind && <Badge>{r.kind}</Badge>}
      <Button variant="ghost" onClick={onChange}>
        {`Change ${title.toLowerCase()}`}
      </Button>
    </Row>
  );
}

/**
 * Two objects side by side as a diff of their YAML (backlog 83). Reads each
 * with the signed-in user's own access through the engine's per-cluster GET;
 * a Secret is compared by keys and value sizes only.
 */
export function CompareDialog() {
  const { left, right, close } = useCompare();
  const [hideNoise, setHideNoise] = useState(true);
  const [picking, setPicking] = useState<"left" | "right" | null>(null);
  const [copied, setCopied] = useState(false);
  const monacoTheme = useMonacoTheme();
  const leftSide = useSide(left);
  const rightSide = useSide(right);

  const set = (next: { left?: CompareRef | null; right?: CompareRef | null }) => useCompare.setState(next);
  const needLeft = !left || picking === "left";
  const needRight = !right || picking === "right";

  const texts = useMemo(() => {
    if (leftSide?.state !== "ok" || rightSide?.state !== "ok") return null;
    return {
      a: toYaml(normalizeObject(leftSide.obj, hideNoise)),
      b: toYaml(normalizeObject(rightSide.obj, hideNoise)),
    };
  }, [leftSide, rightSide, hideNoise]);

  const diff = useMemo(
    () => (texts && left && right ? unifiedDiff(texts.a, texts.b, refLabel(left), refLabel(right)) : ""),
    [texts, left, right],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to say, the diff is on screen */
    }
  }

  const errors = [leftSide, rightSide].flatMap((s) => (s?.state === "error" ? [s.message] : []));

  return (
    <Modal label="Compare resources" title="Compare resources" size="full" placement="center" onClose={close}>
      <Stack gap={3}>
        {needLeft ? (
          <Picker
            title="Left"
            initialCluster={left?.cluster ?? right?.cluster ?? ""}
            onPick={(r) => {
              set({ left: r });
              setPicking(null);
            }}
          />
        ) : (
          <SideHeader title="Left" r={left} onChange={() => setPicking("left")} />
        )}
        {needRight ? (
          <Picker
            title="Right"
            initialCluster={left?.cluster ?? right?.cluster ?? ""}
            onPick={(r) => {
              set({ right: r });
              setPicking(null);
            }}
          />
        ) : (
          <SideHeader title="Right" r={right} onChange={() => setPicking("right")} />
        )}

        {left && right && (
          <Row gap={3} align="center" wrap>
            <label className="ctl" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} />
              Hide noise
            </label>
            <Button variant="ghost" onClick={() => set({ left: right, right: left })}>
              Swap sides
            </Button>
            <Button variant="ghost" disabled={!diff} onClick={() => void copy()}>
              {copied ? "Copied" : "Copy diff"}
            </Button>
            {(isSecret(left) || isSecret(right)) && (
              <span className="muted small">Secret values are never fetched: only keys and value sizes are compared.</span>
            )}
          </Row>
        )}

        {errors.map((m) => (
          <InlineBanner key={m} flush>
            {m}
          </InlineBanner>
        ))}
        {(leftSide?.state === "loading" || rightSide?.state === "loading") && errors.length === 0 && <SkeletonLines lines={6} />}
        {texts && left && right && sameRef(left, right) && <span className="muted small">Both sides are the same object.</span>}
        {texts && !diff && <Badge tone="ok">{hideNoise ? "No differences (noise hidden)" : "No differences"}</Badge>}
        {texts && (
          <div style={{ height: "56vh" }}>
            <DiffEditor
              original={texts.a}
              modified={texts.b}
              language="yaml"
              theme={monacoTheme}
              options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
            />
          </div>
        )}
      </Stack>
    </Modal>
  );
}

/** Mounted once in the app: shows the dialog while an entry point has asked for it. */
export function CompareHost() {
  const open = useCompare((s) => s.open);
  return open ? <CompareDialog /> : null;
}
