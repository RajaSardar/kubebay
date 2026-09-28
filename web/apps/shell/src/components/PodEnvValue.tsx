import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { resolveFieldRef, resolveResourceFieldRef } from "../lib/podEnv";
import { SecretValueReveal } from "./SecretValueReveal";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface ContainerResources {
  resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
}

// Resolves one container env var's display value, mirroring what
// Kubernetes itself would inject -- literal values pass through, fieldRef/
// resourceFieldRef resolve against the live pod/container objects,
// configMapKeyRef is fetched on demand, and secretKeyRef stays masked
// behind SecretValueReveal (backlog #18, Phase 1).
export function PodEnvValue({
  cluster,
  namespace,
  pod,
  container,
  envVar,
}: {
  cluster: string;
  namespace: string;
  pod: Record<string, unknown>;
  container: ContainerResources;
  envVar: { name: string; value?: string; valueFrom?: Record<string, unknown> };
}) {
  if (envVar.value !== undefined) {
    return <span className="mono small">{envVar.value}</span>;
  }

  const valueFrom = rec(envVar.valueFrom);
  if (Object.keys(valueFrom).length === 0) {
    return <span className="muted small">—</span>;
  }

  const fieldRef = rec(valueFrom.fieldRef);
  if (fieldRef.fieldPath) {
    const fieldPath = str(fieldRef.fieldPath);
    const resolved = resolveFieldRef(pod, fieldPath);
    return <span className="mono small">{resolved ?? `fieldRef(${fieldPath})`}</span>;
  }

  const resourceFieldRef = rec(valueFrom.resourceFieldRef);
  if (resourceFieldRef.resource) {
    const resource = str(resourceFieldRef.resource);
    const resolved = resolveResourceFieldRef(container, { resource, divisor: str(resourceFieldRef.divisor) || undefined });
    return <span className="mono small">{resolved ?? `resourceFieldRef(${resource})`}</span>;
  }

  const configMapKeyRef = rec(valueFrom.configMapKeyRef);
  if (configMapKeyRef.name) {
    return (
      <ConfigMapEnvValue
        cluster={cluster}
        ns={namespace}
        name={str(configMapKeyRef.name)}
        dataKey={str(configMapKeyRef.key)}
      />
    );
  }

  const secretKeyRef = rec(valueFrom.secretKeyRef);
  if (secretKeyRef.name) {
    return <SecretValueReveal cluster={cluster} ns={namespace} name={str(secretKeyRef.name)} secretKey={str(secretKeyRef.key)} />;
  }

  return <span className="muted small">—</span>;
}

function ConfigMapEnvValue({ cluster, ns, name, dataKey }: { cluster: string; ns: string; name: string; dataKey: string }) {
  const q = useQuery({
    queryKey: ["configmap-env", cluster, ns, name],
    queryFn: () => api.getObject(cluster, "v1/configmaps", ns, name),
    staleTime: 30_000,
  });

  const placeholder = `configMapKeyRef(${name})[${dataKey}]`;
  if (q.isLoading) return <span className="muted small">loading…</span>;

  const value = rec(rec(q.data).data)[dataKey];
  return <span className="mono small">{typeof value === "string" ? value : placeholder}</span>;
}
