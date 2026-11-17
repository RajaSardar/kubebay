/** Where an object opens. Pods have no detail page: their list opens the drawer. */
export function targetFor(o: { slug: string; ns: string; name: string; clusterScoped?: boolean; ref?: string }): string {
  if (o.slug === "pods") return `/workloads?pod=${encodeURIComponent(`${o.ns}/${o.name}`)}`;
  if (o.slug === "crds") {
    // A CRD opens the objects it defines (the ScaledObjects, for scaledobjects.keda.sh)...
    if (o.ref) return `/r/${o.ref}${o.clusterScoped ? "?scoped=0" : ""}`;
    // ...or, not knowing which kind that is, the CRDs page at its API group: its name is "plural.group".
    return `/crds?group=${encodeURIComponent(o.name.slice(o.name.indexOf(".") + 1))}`;
  }
  const base = `/detail/${o.slug}/${o.ns || "_"}/${o.name}`;
  // A custom resource with no namespace must say so; the route cannot tell.
  return o.slug.startsWith("ext--") && !o.ns ? `${base}?scoped=0` : base;
}
