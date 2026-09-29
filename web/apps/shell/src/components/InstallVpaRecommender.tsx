import { useState } from "react";
import { Badge, Button, Card, InlineBanner, Row, TextField } from "@kubebay/ui";
import { helmApi, helmMarketApi, type HelmRelease } from "../lib/api";
import { summarizeManifestResources, countManifestKinds, type ManifestResource } from "../lib/manifestSummary";

const VPA_REPO = { name: "kubebay-autoscaler", url: "https://kubernetes.github.io/autoscaler" };
const VPA_CHART_REF = "kubebay-autoscaler/vertical-pod-autoscaler";
const VPA_RELEASE_NAME = "kubebay-vpa-recommender";
const VPA_NAMESPACE = "kube-system";
// Pinned to recommender-only: the updater (evicts/resizes running pods) and
// admission-controller (a mutating webhook, with its own TLS cert bundle)
// are both disabled, so this install never touches a running workload and
// never needs a webhook -- updateMode: "Off" is entirely a function of what
// reads the VPA objects this creates, not of anything installed here.
const VPA_VALUES_YAML = ["recommender:", "  enabled: true", "updater:", "  enabled: false", "admissionController:", "  enabled: false"].join("\n");
const CONFIRM_PHRASE = "install";

type State =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "previewed"; resources: ManifestResource[] }
  | { status: "installing"; resources: ManifestResource[] }
  | { status: "installed"; release: HelmRelease }
  | { status: "error"; message: string };

async function runUpgrade(cluster: string, dryRun: boolean): Promise<HelmRelease> {
  await helmMarketApi.addRepo(VPA_REPO);
  return helmApi.upgrade({
    cluster,
    ns: VPA_NAMESPACE,
    name: VPA_RELEASE_NAME,
    chartRef: VPA_CHART_REF,
    valuesYaml: VPA_VALUES_YAML,
    dryRun,
  });
}

export function InstallVpaRecommender({ cluster }: { cluster: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [confirmText, setConfirmText] = useState("");

  async function preview() {
    setState({ status: "previewing" });
    try {
      const rel = await runUpgrade(cluster, true);
      setState({ status: "previewed", resources: summarizeManifestResources(rel.manifest ?? "") });
    } catch (e) {
      setState({ status: "error", message: String(e instanceof Error ? e.message : e) });
    }
  }

  async function install(resources: ManifestResource[]) {
    setState({ status: "installing", resources });
    try {
      const release = await runUpgrade(cluster, false);
      setState({ status: "installed", release });
    } catch (e) {
      setState({ status: "error", message: String(e instanceof Error ? e.message : e) });
    }
  }

  if (state.status === "idle" || state.status === "error") {
    return (
      <div>
        <Button onClick={() => void preview()}>Install VPA recommender</Button>
        {state.status === "error" && <div className="error-text small" style={{ marginTop: 8 }}>{state.message}</div>}
      </div>
    );
  }

  if (state.status === "previewing") {
    return <p className="muted small">Rendering a preview — nothing is installed yet…</p>;
  }

  if (state.status === "installed") {
    return (
      <InlineBanner tone="ok">
        Installed <span className="mono">{state.release.name}</span> ({state.release.status}). Recommendations from
        real VPA objects will appear on this page once the recommender has observed your workloads for a bit.
      </InlineBanner>
    );
  }

  const resources = state.status === "installing" ? state.resources : state.resources;
  const counts = countManifestKinds(resources);
  const installing = state.status === "installing";

  return (
    <Card style={{ marginTop: 8 }}>
      <p className="small" style={{ marginBottom: 8 }}>
        This will create, in <span className="mono">{VPA_NAMESPACE}</span>:
      </p>
      <Row gap={2} wrap style={{ marginBottom: 12 }}>
        {Object.entries(counts).map(([kind, count]) => (
          <Badge key={kind}>
            {kind}
            {count > 1 ? ` ×${count}` : ""}
          </Badge>
        ))}
      </Row>
      <ul className="muted small" style={{ margin: "0 0 12px", paddingLeft: 18 }}>
        <li>Recommender only — the updater and admission-controller stay disabled, so nothing evicts or resizes a running pod, and no admission webhook is installed.</li>
        <li>
          Recommendations only take effect if a VPA object with <code className="mono">updateMode: "Off"</code> targets your
          workload — installing this component alone changes nothing about how pods run.
        </li>
        <li>Grants cluster-wide read access to pods/deployments (required for the recommender to compute usage) plus write access to VerticalPodAutoscaler objects.</li>
        <li>Upstream's own chart README currently marks this chart as under development and not recommended for production use.</li>
      </ul>
      <Row gap={2} align="center">
        <TextField
          placeholder={`type "${CONFIRM_PHRASE}" to confirm`}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          spellCheck={false}
          disabled={installing}
        />
        <Button disabled={installing || confirmText !== CONFIRM_PHRASE} onClick={() => void install(resources)}>
          {installing ? "Installing…" : "Install"}
        </Button>
      </Row>
    </Card>
  );
}
