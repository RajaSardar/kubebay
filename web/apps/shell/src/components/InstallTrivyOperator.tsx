import { useState } from "react";
import { Badge, Button, Card, InlineBanner, Row, TextField } from "@kubebay/ui";
import { helmApi, helmMarketApi, type HelmRelease } from "../lib/api";
import { summarizeManifestResources, countManifestKinds, type ManifestResource } from "../lib/manifestSummary";

const TRIVY_REPO = { name: "aqua", url: "https://aquasecurity.github.io/helm-charts/" };
const TRIVY_CHART_REF = "aqua/trivy-operator";
const TRIVY_RELEASE_NAME = "kubebay-trivy-operator";
const TRIVY_NAMESPACE = "trivy-system";
// Kubebay only ever surfaces VulnerabilityReport/ClusterVulnerabilityReport
// (backlog #16) -- the chart's other four scanners (config audit, exposed
// secrets, infra assessment, RBAC assessment) and cluster-compliance would
// run real scan Jobs cluster-wide for findings nothing in Kubebay's UI shows
// today. Same instinct as the VPA install (backlog #20): scope the install
// to exactly what's built, not everything the chart can do.
const TRIVY_VALUES_YAML = [
  "operator:",
  "  vulnerabilityScannerEnabled: true",
  "  configAuditScannerEnabled: false",
  "  exposedSecretScannerEnabled: false",
  "  infraAssessmentScannerEnabled: false",
  "  rbacAssessmentScannerEnabled: false",
  "  clusterComplianceEnabled: false",
].join("\n");
const CONFIRM_PHRASE = "install";

type State =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "previewed"; resources: ManifestResource[] }
  | { status: "installing"; resources: ManifestResource[] }
  | { status: "installed"; release: HelmRelease }
  | { status: "error"; message: string };

async function runUpgrade(cluster: string, dryRun: boolean): Promise<HelmRelease> {
  await helmMarketApi.addRepo(TRIVY_REPO);
  return helmApi.upgrade({
    cluster,
    ns: TRIVY_NAMESPACE,
    name: TRIVY_RELEASE_NAME,
    chartRef: TRIVY_CHART_REF,
    valuesYaml: TRIVY_VALUES_YAML,
    dryRun,
  });
}

/**
 * The second named exception to backlog #2/#3/#16's "detect, never install"
 * position, mirroring backlog #20's VPA install and for the same concrete
 * reason: Trivy-Operator's official chart is distributed via a plain HTTPS
 * chart repo (https://aquasecurity.github.io/helm-charts/), never OCI --
 * verified against the chart's own README before building this, not assumed
 * -- so the KEDA-style "no OCI registry client" blocker never applies here.
 * The two remaining Helm-layer blockers backlog #20 already closed (no
 * `helm repo add`, no dry-run) are reused as-is; this needed zero engine
 * changes.
 */
export function InstallTrivyOperator({ cluster }: { cluster: string }) {
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
        <Button onClick={() => void preview()}>Install Trivy-Operator</Button>
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
        Installed <span className="mono">{state.release.name}</span> ({state.release.status}). Vulnerability
        findings will appear here once the operator has scanned your workloads — on a schedule, not instantly.
      </InlineBanner>
    );
  }

  const resources = state.status === "installing" ? state.resources : state.resources;
  const counts = countManifestKinds(resources);
  const installing = state.status === "installing";

  return (
    <Card style={{ marginTop: 8 }}>
      <p className="small" style={{ marginBottom: 8 }}>
        This will create, in <span className="mono">{TRIVY_NAMESPACE}</span>:
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
        <li>
          Only the vulnerability scanner is enabled — config-audit, exposed-secret, infra-assessment,
          RBAC-assessment, and cluster-compliance scanning all stay off, since Kubebay doesn't surface those
          findings today.
        </li>
        <li>Grants cluster-wide read access to workloads (required to scan them) and creates the VulnerabilityReport CRDs.</li>
        <li>Runs scan Jobs on a schedule and on image-digest change — not instant, and briefly uses cluster CPU/memory per scan.</li>
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
