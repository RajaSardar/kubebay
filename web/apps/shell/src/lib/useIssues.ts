import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, discoveryApi } from "./api";
import { useResourceStream, type StreamState } from "./useResourceStream";
import { loadExceptions, type BpException } from "./bestPracticesExceptions";
import type { BestPracticesInput } from "./bestPractices";
import {
  assembleIssues,
  runDetector,
  type DetectorOutcome,
  type IssueDetector,
  type IssueInputs,
  type IssuesResult,
  type Source,
  type UnavailableReason,
} from "./issues";

type Obj = Record<string, unknown>;

/** A stream as a detector source: its rows once synced, else why there are none. */
function source(s: StreamState): Source {
  if (s.forbidden) return "forbidden";
  return s.synced ? s.rows : "loading";
}
const rowsOf = (s: StreamState): Obj[] | undefined => (s.forbidden || !s.synced ? undefined : s.rows);

const EMPTY: IssuesResult = { issues: [], notChecked: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } };

/**
 * The Issues queue for one cluster (backlog 76), ready for another surface
 * (desktop notifications) to reuse. It opens the same streams, in the same
 * modes, as the Overview, Best practices, Network policy and Upgrade readiness
 * pages, so the shared stream cache serves them and no new endpoint is
 * called. Each detector is memoised on its own streams only. Nothing is shown
 * for a cluster until its own streams have been (re)subscribed: a switch drops
 * the previous cluster's issues in the same render.
 */
export function useIssues(cluster: string | undefined): IssuesResult & { loading: boolean } {
  const c = cluster || undefined;
  const pods = useResourceStream(c, "v1/pods", { mode: "full" });
  const nodes = useResourceStream(c, "v1/nodes", { mode: "full" });
  const deployments = useResourceStream(c, "apps/v1/deployments", { mode: "full" });
  const statefulsets = useResourceStream(c, "apps/v1/statefulsets", { mode: "full" });
  const daemonsets = useResourceStream(c, "apps/v1/daemonsets", { mode: "full" });
  const services = useResourceStream(c, "v1/services", { mode: "full" });
  const slices = useResourceStream(c, "discovery.k8s.io/v1/endpointslices", { mode: "full" });
  const pdbs = useResourceStream(c, "policy/v1/poddisruptionbudgets", { mode: "full" });
  const netpols = useResourceStream(c, "networking.k8s.io/v1/networkpolicies", { mode: "full" });
  const namespaces = useResourceStream(c, "v1/namespaces", { mode: "full" });
  const ingressClasses = useResourceStream(c, "networking.k8s.io/v1/ingressclasses", { mode: "full" });
  const pvcs = useResourceStream(c, "v1/persistentvolumeclaims", { mode: "full" });
  const hpas = useResourceStream(c, "autoscaling/v2/horizontalpodautoscalers", { mode: "full" });
  const cronjobs = useResourceStream(c, "batch/v1/cronjobs", { mode: "full" });

  const apisQ = useQuery({
    queryKey: ["apis", c],
    queryFn: () => discoveryApi.apis(c!),
    enabled: !!c,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const apiVersionsQ = useQuery({
    queryKey: ["apiversions", c],
    queryFn: () => discoveryApi.apiVersions(c!),
    enabled: !!c,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const clustersQ = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const serverVersion = clustersQ.data?.find((x) => x.id === c)?.version;

  const groups = apisQ.data ? new Set(apisQ.data.map((a) => a.group)) : undefined;
  const hasCerts = !!groups?.has("cert-manager.io");
  const hasVelero = !!groups?.has("velero.io");
  const certs = useResourceStream(c, "cert-manager.io/v1/certificates", { mode: "full", enabled: hasCerts });
  const velero = useResourceStream(c, "velero.io/v1/schedules", { mode: "full", enabled: hasVelero });

  // The streams keep the previous cluster's rows for one render after a switch.
  // Issues show only once this component has seen its own cluster's effects.
  const [armed, setArmed] = useState<string | undefined>(undefined);
  useEffect(() => setArmed(c), [c]);
  const live = !!c && armed === c;

  // The last good outcome per detector: a re-sync keeps the list instead of blanking it.
  const lastGood = useRef(new Map<string, DetectorOutcome>());
  useEffect(() => lastGood.current.clear(), [c]);

  const now = () => Date.now();
  function run(id: IssueDetector, input: IssueInputs): DetectorOutcome {
    const o = runDetector(id, c ?? "", { ...input, now: now() }, now());
    const key = `${c}|${id}`;
    if ("issues" in o) lastGood.current.set(key, o);
    else if (o.reason === "loading") return lastGood.current.get(key) ?? o;
    return o;
  }

  /* The streams' state objects change on every flush; their rows are what each detector reads. */
  /* eslint-disable react-hooks/exhaustive-deps */
  const podProblem = useMemo(
    () => run("pod-problem", { pods: source(pods), deployments: source(deployments), statefulsets: source(statefulsets), daemonsets: source(daemonsets), nodes: source(nodes) }),
    [live, c, pods.rows, pods.synced, pods.forbidden, deployments.rows, deployments.synced, deployments.forbidden, statefulsets.rows, statefulsets.synced, statefulsets.forbidden, daemonsets.rows, daemonsets.synced, daemonsets.forbidden, nodes.rows, nodes.synced, nodes.forbidden],
  );
  const nodeCondition = useMemo(() => run("node-condition", { nodes: source(nodes) }), [live, c, nodes.rows, nodes.synced, nodes.forbidden]);
  const serviceNoReady = useMemo(
    () => run("service-no-ready", { services: source(services), pods: source(pods), endpointSlices: source(slices) }),
    [live, c, services.rows, services.synced, services.forbidden, pods.rows, pods.synced, pods.forbidden, slices.rows, slices.synced, slices.forbidden],
  );
  const certExpiry = useMemo(() => {
    const certificates: Source = !groups ? "loading" : hasCerts ? source(certs) : "not-served";
    return run("cert-expiry", { certificates });
  }, [live, c, groups, hasCerts, certs.rows, certs.synced, certs.forbidden]);
  const spof = useMemo(
    () => run("spof", { deployments: source(deployments), statefulsets: source(statefulsets), pdbs: source(pdbs), pods: source(pods), services: source(services), endpointSlices: source(slices) }),
    [live, c, deployments.rows, deployments.synced, deployments.forbidden, statefulsets.rows, statefulsets.synced, statefulsets.forbidden, pdbs.rows, pdbs.synced, pdbs.forbidden, pods.rows, pods.synced, pods.forbidden, services.rows, services.synced, services.forbidden, slices.rows, slices.synced, slices.forbidden],
  );
  const netpolGap = useMemo(() => run("netpol-gap", { pods: source(pods), networkPolicies: source(netpols) }), [live, c, pods.rows, pods.synced, pods.forbidden, netpols.rows, netpols.synced, netpols.forbidden]);
  const exceptions = useMemo<BpException[]>(() => (c ? loadExceptions(c) : []), [c]);
  const bestPractice = useMemo(() => {
    const dep = rowsOf(deployments);
    const core = [dep, rowsOf(statefulsets), rowsOf(pdbs), rowsOf(netpols), rowsOf(namespaces), rowsOf(ingressClasses)];
    let bp: BestPracticesInput | UnavailableReason;
    if ([deployments, statefulsets, pdbs, netpols, namespaces, ingressClasses].some((s) => s.forbidden)) bp = "forbidden";
    else if (core.some((r) => r === undefined) || !groups) bp = "loading";
    else {
      bp = {
        deployments: dep,
        statefulsets: rowsOf(statefulsets),
        pdbs: rowsOf(pdbs),
        networkPolicies: rowsOf(netpols),
        namespaces: rowsOf(namespaces),
        ingressClasses: rowsOf(ingressClasses),
        apiGroups: [...groups],
        services: rowsOf(services),
        pvcs: rowsOf(pvcs),
        nodes: rowsOf(nodes),
        hpas: rowsOf(hpas),
        daemonsets: rowsOf(daemonsets),
        cronjobs: rowsOf(cronjobs),
        pods: rowsOf(pods),
        certificates: hasCerts ? rowsOf(certs) : [],
        veleroSchedules: hasVelero ? rowsOf(velero) : [],
      };
    }
    return run("best-practice", { bestPractices: bp, exceptions });
  }, [
    live, c, groups, hasCerts, hasVelero, exceptions,
    deployments.rows, deployments.synced, deployments.forbidden, statefulsets.rows, statefulsets.synced, statefulsets.forbidden, pdbs.rows, pdbs.synced, pdbs.forbidden,
    netpols.rows, netpols.synced, netpols.forbidden, namespaces.rows, namespaces.synced, namespaces.forbidden, ingressClasses.rows, ingressClasses.synced, ingressClasses.forbidden,
    services.rows, services.synced, services.forbidden, pvcs.rows, pvcs.synced, pvcs.forbidden, nodes.rows, nodes.synced, nodes.forbidden, hpas.rows, hpas.synced, hpas.forbidden,
    daemonsets.rows, daemonsets.synced, daemonsets.forbidden, cronjobs.rows, cronjobs.synced, cronjobs.forbidden, pods.rows, pods.synced, pods.forbidden,
    certs.rows, certs.synced, certs.forbidden, velero.rows, velero.synced, velero.forbidden,
  ]);
  const upgrade = useMemo(
    () => run("upgrade-readiness", { upgrade: { serverVersion, served: apiVersionsQ.data } }),
    [live, c, serverVersion, apiVersionsQ.data],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  return useMemo(() => {
    if (!live) {
      const loading = assembleIssues({});
      return { ...EMPTY, notChecked: loading.notChecked, loading: true };
    }
    const r = assembleIssues({
      "pod-problem": podProblem,
      "node-condition": nodeCondition,
      "service-no-ready": serviceNoReady,
      "cert-expiry": certExpiry,
      spof,
      "netpol-gap": netpolGap,
      "best-practice": bestPractice,
      "upgrade-readiness": upgrade,
    });
    return { ...r, loading: r.notChecked.some((n) => n.reason === "loading") };
  }, [live, podProblem, nodeCondition, serviceNoReady, certExpiry, spof, netpolGap, bestPractice, upgrade]);
}
