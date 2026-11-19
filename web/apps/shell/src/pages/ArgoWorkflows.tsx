import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { ArgoWorkflowsView } from "../components/ArgoWorkflowsView";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { detectArgoWorkflows } from "../lib/argoWorkflows";

const TITLE = "Argo Workflows";

export default function ArgoWorkflows() {
  const { cluster } = useCluster();
  const selectedNs = useSelectedNamespaces(cluster || undefined);
  const ns = selectedNs.length > 0 ? selectedNs : undefined;

  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const detection = useMemo(() => detectArgoWorkflows(crds.data ?? []), [crds.data]);

  const workflows = useResourceStream(detection.workflowGvr ? cluster : undefined, detection.workflowGvr ?? "", {
    mode: "full",
    enabled: !!detection.workflowGvr,
    ns,
  });
  const templates = useResourceStream(detection.templateGvr ? cluster : undefined, detection.templateGvr ?? "", {
    mode: "full",
    enabled: !!detection.templateGvr,
    ns,
  });
  const clusterTemplates = useResourceStream(
    detection.clusterTemplateGvr ? cluster : undefined,
    detection.clusterTemplateGvr ?? "",
    { mode: "full", enabled: !!detection.clusterTemplateGvr },
  );
  const crons = useResourceStream(detection.cronGvr ? cluster : undefined, detection.cronGvr ?? "", {
    mode: "full",
    enabled: !!detection.cronGvr,
    ns,
  });
  const pods = useResourceStream(cluster || undefined, "v1/pods", {
    mode: "full",
    enabled: !!detection.workflowGvr,
    ns,
    labelSelector: "workflows.argoproj.io/workflow",
  });

  if (!cluster) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/argo-workflows" />} level={2} title={TITLE} />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }
  if (crds.isLoading) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/argo-workflows" />} level={2} title={TITLE} />
        <PageLoader message="Checking for Argo Workflows…" />
      </div>
    );
  }
  if (!detection.installed) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/argo-workflows" />} level={2} title={TITLE} />
        <div className="page-body">
          <EmptyState>
            <p>Argo Workflows not detected on this cluster.</p>
            <p className="muted small">
              None of <code className="mono">workflows</code>, <code className="mono">workflowtemplates</code>,{" "}
              <code className="mono">clusterworkflowtemplates</code> or <code className="mono">cronworkflows</code> (group{" "}
              <code className="mono">argoproj.io</code>) was found via cluster discovery.
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/argo-workflows" />} level={2} title={TITLE} count={`· ${workflows.rows.length} workflow(s)`} />
      <div className="page-body">
        <ArgoWorkflowsView
          cluster={cluster}
          gvrs={detection}
          workflows={workflows.rows}
          templates={templates.rows}
          clusterTemplates={clusterTemplates.rows}
          crons={crons.rows}
          pods={pods.rows}
        />
      </div>
    </div>
  );
}
