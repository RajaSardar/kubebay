import { useContext, useMemo, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { Button, InlineBanner, Modal, Row, SegmentedControl, Stack, TextField } from "@kubebay/ui";
import { DiffEditor } from "../lib/monaco";
import { api, type ClusterInfo } from "../lib/api";
import { ownerOf, ownerWarning } from "../lib/gitops";
import { PolicyRejectionError, type PolicyRejectionDetail } from "../lib/policyRejection";
import { useMonacoTheme } from "../lib/theme";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import {
  SIDECAR_GVR,
  SIDECAR_KIND,
  SIDECAR_PRESETS,
  appContainers,
  buildSidecarPatch,
  nativeSidecarSupported,
  podTemplateSpec,
  podVolumes,
  presetForm,
  validateSidecar,
  type SidecarForm,
  type SidecarPresetId,
  type SidecarSlug,
} from "../lib/addSidecar";
import { BlastRadiusPreview } from "./BlastRadiusPreview";
import { PolicyRejectionCard } from "./PolicyRejectionCard";
import { ProdApplyModal } from "./ProdApplyModal";

/** The cluster's version from the clusters list already in the query cache; undefined when unknown. */
function useClusterVersion(cluster: string): string | undefined {
  const client = useContext(QueryClientContext);
  return client?.getQueryData<ClusterInfo[]>(["clusters"])?.find((c) => c.id === cluster)?.version;
}

const column = { flexDirection: "column", alignItems: "flex-start" } as const;

function Field({ label, value, onChange, placeholder, width }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <label className="ctl" style={column}>
      {label}
      <TextField
        aria-label={label}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        style={width ? { width } : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * Add sidecar (backlog 56, docs/ADD_SIDECAR.md): append one container to a
 * workload's pod template from a preset or a form. Preview dry-runs the exact
 * strategic patch and shows the server's result as a diff; Add sidecar sends
 * that same patch, only after the preview and only on a click.
 */
export function AddSidecarDialog({
  slug,
  cluster,
  obj,
  onClose,
  onApplied,
}: {
  slug: SidecarSlug;
  cluster: string;
  obj: Record<string, unknown>;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  const name = String(meta.name ?? "");
  const ns = String(meta.namespace ?? "");
  const gvr = SIDECAR_GVR[slug];
  const owner = ownerOf(obj);
  const version = useClusterVersion(cluster);
  const native = nativeSidecarSupported(version);
  const prod = useClusterLooksProduction(cluster);
  const monacoTheme = useMonacoTheme();
  const pod = useMemo(() => podTemplateSpec(slug, obj), [slug, obj]);
  const apps = useMemo(() => appContainers(pod), [pod]);
  const volumes = useMemo(() => podVolumes(pod), [pod]);

  const [preset, setPreset] = useState<SidecarPresetId>("custom");
  const [form, setForm] = useState<SidecarForm>(() => presetForm("custom", apps, native));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejection, setRejection] = useState<PolicyRejectionDetail | null>(null);
  const [preview, setPreview] = useState<{ yaml: string; live: string; result: string } | null>(null);
  const [confirmingProd, setConfirmingProd] = useState(false);

  const edit = (patch: Partial<SidecarForm>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...patch }));
  };
  const pick = (id: SidecarPresetId) => {
    setPreset(id);
    setTouched(id !== "custom");
    setForm(presetForm(id, apps, native));
  };

  const errors = useMemo(() => validateSidecar(slug, obj, form, native), [slug, obj, form, native]);
  const patchYaml = useMemo(() => JSON.stringify(buildSidecarPatch(slug, obj, form), null, 2), [slug, obj, form]);
  const previewed = preview !== null && preview.yaml === patchYaml;
  const req = (dryRun: boolean) => ({ cluster, gvr, ns, name, yaml: patchYaml, dryRun, force: false, mode: "strategic" as const, action: "add-sidecar" });

  async function attempt(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    setRejection(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof PolicyRejectionError) setRejection(e.rejection);
      else setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const runPreview = () =>
    void attempt(async () => {
      const yaml = patchYaml;
      const [live, r] = await Promise.all([api.getYamlText(cluster, gvr, ns, name), api.applyYaml(req(true))]);
      setPreview({ yaml, live, result: r.resultYaml ?? "" });
    });

  const runApply = () =>
    void attempt(async () => {
      await api.applyYaml(req(false));
      onApplied(
        slug === "cronjobs"
          ? `Sidecar ${form.name.trim()} added; the next Jobs get it.`
          : `Sidecar ${form.name.trim()} added; rollout restart started.`,
      );
    });

  const mounted = (v: string) => form.mounts.find((m) => m.volume === v);
  const toggleMount = (v: string, on: boolean) =>
    edit({ mounts: on ? [...form.mounts, { volume: v, mountPath: `/mnt/${v}` }] : form.mounts.filter((m) => m.volume !== v) });
  const setMountPath = (v: string, p: string) => edit({ mounts: form.mounts.map((m) => (m.volume === v ? { ...m, mountPath: p } : m)) });
  const emptyDir = form.emptyDir;
  const setEmptyDir = (patch: Partial<NonNullable<SidecarForm["emptyDir"]>>) => emptyDir && edit({ emptyDir: { ...emptyDir, ...patch } });

  const title = `Add sidecar to ${name}`;
  return (
    <Modal label={title} title={title} onClose={onClose} placement="center" size="wide">
      <Stack gap={3}>
        {owner && <InlineBanner flush role="alert">{ownerWarning(owner)}</InlineBanner>}
        <SegmentedControl label="Preset" options={SIDECAR_PRESETS} value={preset} onChange={pick} />

        <Row gap={3} wrap align="end">
          <Field label="Name" value={form.name} onChange={(v) => edit({ name: v })} placeholder="log-shipper" />
          <Field label="Image" value={form.image} onChange={(v) => edit({ image: v })} placeholder="busybox:1.36" width={320} />
        </Row>
        <Row gap={3} wrap align="end">
          <Field label="Command" value={form.command} onChange={(v) => edit({ command: v })} placeholder="sh -c" width={220} />
          <Field label="Args" value={form.args} onChange={(v) => edit({ args: v })} placeholder="'echo hello'" width={320} />
        </Row>
        <Row gap={3} wrap align="end">
          <Field label="Env" value={form.env} onChange={(v) => edit({ env: v })} placeholder='LEVEL=debug MSG="a b"' width={320} />
          <Field label="Ports" value={form.ports} onChange={(v) => edit({ ports: v })} placeholder="8080, 9090/UDP" />
        </Row>
        <Row gap={3} wrap align="end">
          <Field label="CPU request" value={form.cpuRequest} onChange={(v) => edit({ cpuRequest: v })} placeholder="10m" width={100} />
          <Field label="Memory request" value={form.memoryRequest} onChange={(v) => edit({ memoryRequest: v })} placeholder="16Mi" width={100} />
          <Field label="CPU limit" value={form.cpuLimit} onChange={(v) => edit({ cpuLimit: v })} width={100} />
          <Field label="Memory limit" value={form.memoryLimit} onChange={(v) => edit({ memoryLimit: v })} placeholder="64Mi" width={100} />
        </Row>
        <span className="muted small">Command, args and env split on spaces; quotes keep words together. Env takes KEY=value words.</span>

        {volumes.length > 0 && (
          <Stack gap={2}>
            <span className="small strong">Mount existing volumes</span>
            {volumes.map((v) => (
              <Row key={v} gap={2} align="center" wrap>
                <label className="ctl">
                  <input type="checkbox" checked={!!mounted(v)} onChange={(e) => toggleMount(v, e.target.checked)} />
                  <span className="mono">{`Mount ${v}`}</span>
                </label>
                {mounted(v) && (
                  <TextField
                    aria-label={`Mount path for ${v}`}
                    value={mounted(v)!.mountPath}
                    spellCheck={false}
                    onChange={(e) => setMountPath(v, e.target.value)}
                  />
                )}
              </Row>
            ))}
          </Stack>
        )}

        <Stack gap={2}>
          <label className="ctl">
            <input
              type="checkbox"
              checked={!!emptyDir}
              onChange={(e) => edit({ emptyDir: e.target.checked ? { name: "shared", mountPath: "/shared", shareWith: [] } : null })}
            />
            New shared emptyDir
          </label>
          {emptyDir && (
            <>
              <Row gap={3} wrap align="end">
                <Field label="Volume name" value={emptyDir.name} onChange={(v) => setEmptyDir({ name: v })} />
                <Field label="Mount path" value={emptyDir.mountPath} onChange={(v) => setEmptyDir({ mountPath: v })} width={220} />
              </Row>
              <Row gap={3} wrap align="center">
                {apps.map((c) => (
                  <label key={c} className="ctl">
                    <input
                      type="checkbox"
                      checked={emptyDir.shareWith.includes(c)}
                      onChange={(e) =>
                        setEmptyDir({ shareWith: e.target.checked ? [...emptyDir.shareWith, c] : emptyDir.shareWith.filter((x) => x !== c) })
                      }
                    />
                    {`Also mount in ${c}`}
                  </label>
                ))}
              </Row>
              <span className="muted small">Mounted at the same path in each container picked; the mount hides whatever the image had there.</span>
            </>
          )}
        </Stack>

        {native ? (
          <Stack gap={2}>
            <SegmentedControl
              label="Sidecar type"
              options={[
                { value: "native", label: "Native sidecar" },
                { value: "regular", label: "Regular container" },
              ]}
              value={form.native ? "native" : "regular"}
              onChange={(v) => edit({ native: v === "native" })}
            />
            <span className="muted small">
              {form.native
                ? "A native sidecar is an init container with restartPolicy: Always. It starts before the app containers, runs as long as the pod and never keeps a Job from finishing."
                : "A regular container is appended to containers. It starts alongside the app containers, in no set order, and a Job is not done until it exits."}
            </span>
          </Stack>
        ) : (
          <span className="muted small">
            {`A native sidecar (an init container with restartPolicy: Always) needs Kubernetes 1.29 or newer, and this cluster is ${version || "an unknown version"}, so the sidecar is a regular container.`}
          </span>
        )}

        <InlineBanner flush tone="warn">
          {slug === "cronjobs"
            ? "This changes the CronJob's job template: the Jobs it creates next get the sidecar, and running Jobs keep their pods."
            : "Changing the pod template triggers a rollout restart: every pod is replaced, following the rollout strategy."}
        </InlineBanner>
        {slug !== "cronjobs" && <BlastRadiusPreview cluster={cluster} kind={SIDECAR_KIND[slug]} obj={obj} action="restart" />}

        {touched && errors.length > 0 && (
          <InlineBanner flush role="alert">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e) => (
                <li key={e} className="small">
                  {e}
                </li>
              ))}
            </ul>
          </InlineBanner>
        )}

        {preview && (
          <Stack gap={1}>
            <span className="muted small">
              {previewed ? "Server preview (dry-run): live on the left, with the sidecar on the right." : "The form changed since this preview: preview again before you add it."}
            </span>
            <div style={{ height: 260 }}>
              <DiffEditor
                original={preview.live}
                modified={preview.result}
                language="yaml"
                theme={monacoTheme}
                options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 12, automaticLayout: true }}
              />
            </div>
          </Stack>
        )}

        {rejection && <PolicyRejectionCard rejection={rejection} />}
        {err && <InlineBanner flush>{err}</InlineBanner>}

        <Row justify="end" gap={2}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ghost" disabled={busy || errors.length > 0} onClick={runPreview}>
            Preview
          </Button>
          <Button variant="primary" disabled={busy || errors.length > 0 || !previewed} onClick={() => (prod.production ? setConfirmingProd(true) : runApply())}>
            Add sidecar
          </Button>
        </Row>
      </Stack>
      {confirmingProd && (
        <ProdApplyModal
          context={prod.context}
          target={`the sidecar to ${SIDECAR_KIND[slug]} ${name}`}
          onCancel={() => setConfirmingProd(false)}
          onConfirm={() => {
            setConfirmingProd(false);
            runApply();
          }}
        />
      )}
    </Modal>
  );
}
