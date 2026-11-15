import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, DataTable, InlineBanner, Row, Select, SkeletonLines, Stack } from "@kubebay/ui";
import { cloudDiscoveryApi, type DiscoveredGkeCluster } from "../lib/api";

type ScanResult = Awaited<ReturnType<typeof cloudDiscoveryApi.scanGke>>;

/**
 * Backlog #14: find GKE clusters your own gcloud can see and add one with a
 * click. Nothing runs until asked. An import writes a kubeconfig Kubebay owns
 * (~/.kubebay/discovered) that signs in with gke-gcloud-auth-plugin, and
 * never touches your own.
 */
export function GkeDiscovery() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const projects = useQuery({ queryKey: ["gcp-projects"], queryFn: cloudDiscoveryApi.gcpProjects, enabled: open, staleTime: 5 * 60_000, retry: false });
  const [project, setProject] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [imported, setImported] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState<string | null>(null);

  // Start on gcloud's default project, else the first.
  useEffect(() => {
    if (project !== null || !projects.data) return;
    setProject((projects.data.find((p) => p.default) ?? projects.data[0])?.id ?? "");
  }, [projects.data, project]);

  async function runScan() {
    setBusy(true);
    setErr("");
    try {
      setScan(await cloudDiscoveryApi.scanGke(project ?? ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(c: DiscoveredGkeCluster) {
    setImporting(c.context);
    setErr("");
    try {
      await cloudDiscoveryApi.importGke(c.project, c.location, c.name);
      setImported((m) => ({ ...m, [c.context]: true }));
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["clusters"] });
    } catch (e) {
      setErr(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(null);
    }
  }

  if (!open) {
    return (
      <Row gap={2} align="center" wrap>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Find GKE clusters
        </Button>
        <span className="muted small">Lists the GKE clusters your gcloud can see, so you can add one without editing a kubeconfig.</span>
      </Row>
    );
  }

  return (
    <Stack gap={3}>
      <strong>GKE clusters</strong>
      <div className="muted small">
        Runs your own gcloud with your own login (container.clusters.list in the project you pick), only when you scan.
        Importing writes a kubeconfig Kubebay owns, in ~/.kubebay/discovered, that signs in with gke-gcloud-auth-plugin
        (install it with gcloud components install gke-gcloud-auth-plugin); your own kubeconfig is never changed.
      </div>
      {projects.isLoading && <SkeletonLines lines={2} label="Reading Google Cloud projects…" />}
      {projects.error && <InlineBanner flush>{projects.error instanceof Error ? projects.error.message : String(projects.error)}</InlineBanner>}
      {projects.data && (
        <Row gap={2} align="center" wrap>
          <Select
            aria-label="Google Cloud project"
            value={project ?? ""}
            onChange={(e) => {
              setProject(e.target.value);
              setScan(null);
            }}
          >
            {projects.data.length === 0 && <option value="">no projects</option>}
            {projects.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name && p.name !== p.id ? `${p.id} (${p.name})` : p.id}
              </option>
            ))}
          </Select>
          <Button disabled={busy || !project} onClick={() => void runScan()}>
            {busy ? "Scanning…" : "Scan"}
          </Button>
        </Row>
      )}
      {err && <InlineBanner flush>{err}</InlineBanner>}
      {scan && scan.errors.length > 0 && (
        <InlineBanner tone="warn" flush>
          <Stack gap={1}>
            {scan.errors.map((e, i) => (
              <span key={i}>{e.message}</span>
            ))}
          </Stack>
        </InlineBanner>
      )}
      {scan && (
        <DataTable
          rows={scan.clusters}
          rowKey={(c) => c.context}
          empty={<div className="muted small">No GKE clusters in this project.</div>}
          columns={[
            { key: "name", header: "Cluster", className: "mono small strong", render: (c) => c.name },
            { key: "location", header: "Location", className: "mono small", title: (c) => c.location, render: (c) => c.location },
            { key: "version", header: "Version", className: "mono small", title: (c) => c.version ?? "", render: (c) => c.version ?? "—" },
            { key: "status", header: "Status", className: "small", render: (c) => c.status ?? "—" },
            {
              key: "action",
              header: "",
              render: (c) =>
                c.imported ? (
                  <Badge>in your kubeconfig</Badge>
                ) : imported[c.context] ? (
                  <Badge tone="ok">imported</Badge>
                ) : (
                  <Button variant="ghost" disabled={importing !== null} onClick={() => void runImport(c)}>
                    {importing === c.context ? "Importing…" : "Import"}
                  </Button>
                ),
            },
          ]}
        />
      )}
    </Stack>
  );
}
