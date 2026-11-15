export interface VolumeLink {
  kind: string;
  ns: string;
  name: string;
}

export interface VolumeDescription {
  /** The volume's Kubernetes source key, e.g. "persistentVolumeClaim". */
  type: string;
  /** Short badge label, e.g. "PVC". */
  label: string;
  detail: string;
  /** Set when this volume references another namespaced object Kubebay can show a detail page for. */
  link?: VolumeLink;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function arr(v: unknown): Record<string, unknown>[] {
  return (v ?? []) as Record<string, unknown>[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function describeVolume(volume: Record<string, unknown>, namespace: string): VolumeDescription {
  if (volume.persistentVolumeClaim) {
    const pvc = rec(volume.persistentVolumeClaim);
    const claimName = str(pvc.claimName);
    return {
      type: "persistentVolumeClaim",
      label: "PVC",
      detail: pvc.readOnly ? `${claimName} (ro)` : claimName,
      link: claimName ? { kind: "persistentvolumeclaims", ns: namespace, name: claimName } : undefined,
    };
  }

  if (volume.configMap) {
    const cm = rec(volume.configMap);
    const name = str(cm.name);
    return {
      type: "configMap",
      label: "ConfigMap",
      detail: cm.optional ? `${name} (optional)` : name,
      link: name ? { kind: "configmaps", ns: namespace, name } : undefined,
    };
  }

  if (volume.secret) {
    const secret = rec(volume.secret);
    const secretName = str(secret.secretName);
    return {
      type: "secret",
      label: "Secret",
      detail: secret.optional ? `${secretName} (optional)` : secretName,
      link: secretName ? { kind: "secrets", ns: namespace, name: secretName } : undefined,
    };
  }

  if (volume.hostPath) {
    const hp = rec(volume.hostPath);
    return { type: "hostPath", label: "hostPath", detail: `${str(hp.path)} (${str(hp.type) || "unset"})` };
  }

  if (volume.emptyDir) {
    const ed = rec(volume.emptyDir);
    const medium = str(ed.medium) || "disk";
    const sizeLimit = str(ed.sizeLimit) || "none";
    return { type: "emptyDir", label: "emptyDir", detail: `medium=${medium} sizeLimit=${sizeLimit}` };
  }

  if (volume.projected) {
    const sourceKinds = arr(rec(volume.projected).sources).map((s) => Object.keys(s)[0] ?? "unknown");
    return { type: "projected", label: "projected", detail: sourceKinds.join(", ") || "no sources" };
  }

  if (volume.downwardAPI) {
    const items = arr(rec(volume.downwardAPI).items);
    const paths = items.map((i) => str(rec(i.fieldRef).fieldPath) || str(rec(i.resourceFieldRef).resource)).filter(Boolean);
    return { type: "downwardAPI", label: "downwardAPI", detail: paths.join(", ") || "no items" };
  }

  const type = Object.keys(volume).find((k) => k !== "name") ?? "unknown";
  const detailObj = rec(volume[type]);
  const detail =
    str(detailObj.claimName) || str(detailObj.name) || str(detailObj.secretName) || str(detailObj.path) || type;
  return { type, label: type, detail };
}
