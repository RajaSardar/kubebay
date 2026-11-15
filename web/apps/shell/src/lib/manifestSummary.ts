export interface ManifestResource {
  kind: string;
  name: string;
}

// Extracts {kind, name} per document from a raw multi-doc Kubernetes
// manifest, the same "---"-split shape splitYAMLDocs handles engine-side.
// Deliberately a small hand-rolled line scan rather than a YAML parser: a
// preview list only ever needs `kind` and `metadata.name`, both single
// scalar lines in every manifest this app generates, so pulling in a full
// YAML dependency just to read two fields would be waste (same instinct as
// this codebase's other hand-rolled extractors, e.g. karpenterDangerousChange).
export function summarizeManifestResources(manifest: string): ManifestResource[] {
  const docs = manifest
    .split(/\n---\s*\n?/)
    .map((d) => d.replace(/^---\s*\n?/, "").trim())
    .filter(Boolean);

  const out: ManifestResource[] = [];
  for (const doc of docs) {
    const kindMatch = /^kind:\s*(\S+)/m.exec(doc);
    const nameMatch = /^\s*name:\s*(\S+)/m.exec(doc);
    if (!kindMatch || !nameMatch) continue;
    out.push({ kind: kindMatch[1]!, name: nameMatch[1]! });
  }
  return out;
}

export function countManifestKinds(resources: ManifestResource[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of resources) {
    counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  }
  return counts;
}
