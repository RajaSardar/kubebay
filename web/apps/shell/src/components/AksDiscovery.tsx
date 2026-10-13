import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, DataTable, InlineBanner, Row, Select, SkeletonLines, Stack } from "@kubebay/ui";
import { cloudDiscoveryApi, type DiscoveredAksCluster } from "../lib/api";

type ScanResult = Awaited<ReturnType<typeof cloudDiscoveryApi.scanAks>>;

/**
 * Backlog #14: find AKS clusters your own az can see and add one with a
 * click. Nothing runs until asked. Only clusters that sign in with Microsoft
 * Entra ID import: the kubeconfig Kubebay writes (~/.kubebay/discovered) gets
 * tokens from kubelogin and your az login, so no client certificate lands on
 * disk, and your own kubeconfig is never touched.
 */
export function AksDiscovery() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const subs = useQuery({ queryKey: ["azure-subscriptions"], queryFn: cloudDiscoveryApi.azureSubscriptions, enabled: open, staleTime: 5 * 60_000, retry: false });
  const [sub, setSub] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [imported, setImported] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState<string | null>(null);

  // Start on az's current subscription, else the first.
  useEffect(() => {
    if (sub !== null || !subs.data) return;
    setSub((subs.data.find((s) => s.default) ?? subs.data[0])?.id ?? "");
  }, [subs.data, sub]);

  async function runScan() {
    setBusy(true);
    setErr("");
    try {
      setScan(await cloudDiscoveryApi.scanAks(sub ?? ""));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(c: DiscoveredAksCluster) {
    setImporting(c.context);
    setErr("");
    try {
      await cloudDiscoveryApi.importAks(c.subscription, c.resourceGroup, c.name);
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
          Find AKS clusters
        </Button>
        <span className="muted small">Lists the AKS clusters your az can see, so you can add one without editing a kubeconfig.</span>
      </Row>
    );
  }

  return (
    <Stack gap={3}>
      <strong>AKS clusters</strong>
      <div className="muted small">
        Runs your own az with your own login, only when you scan. Only clusters that use Microsoft Entra ID can be imported:
        the kubeconfig Kubebay writes, in ~/.kubebay/discovered, signs in through kubelogin with your az login (install it
        with az aks install-cli), so no certificate or token is stored. Your own kubeconfig is never changed.
      </div>
      {subs.isLoading && <SkeletonLines lines={2} label="Reading Azure subscriptions…" />}
      {subs.error && <InlineBanner flush>{subs.error instanceof Error ? subs.error.message : String(subs.error)}</InlineBanner>}
      {subs.data && (
        <Row gap={2} align="center" wrap>
          <Select
            aria-label="Azure subscription"
            value={sub ?? ""}
            onChange={(e) => {
              setSub(e.target.value);
              setScan(null);
            }}
          >
            {subs.data.length === 0 && <option value="">no subscriptions</option>}
            {subs.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ? `${s.name} (${s.id})` : s.id}
              </option>
            ))}
          </Select>
          <Button disabled={busy || !sub} onClick={() => void runScan()}>
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
          empty={<div className="muted small">No AKS clusters in this subscription.</div>}
          columns={[
            { key: "name", header: "Cluster", className: "mono small strong", render: (c) => c.name },
            { key: "group", header: "Resource group", className: "mono small", title: (c) => c.resourceGroup, render: (c) => c.resourceGroup },
            { key: "location", header: "Location", className: "mono small", render: (c) => c.location },
            { key: "version", header: "Version", className: "mono small", render: (c) => c.version ?? "—" },
            {
              key: "status",
              header: "Status",
              className: "small",
              render: (c) => (
                <Row gap={1} align="center" wrap>
                  <span>{c.status ?? "—"}</span>
                  {c.private && (
                    <Badge tone="warn" title="The API server is reachable only from its own network">
                      private
                    </Badge>
                  )}
                </Row>
              ),
            },
            {
              key: "action",
              header: "",
              render: (c) =>
                c.imported ? (
                  <Badge>in your kubeconfig</Badge>
                ) : imported[c.context] ? (
                  <Badge tone="ok">imported</Badge>
                ) : !c.importable ? (
                  <span className="muted small">{c.reason ?? "can't be imported"}</span>
                ) : (
                  <Button variant="ghost" aria-label={`Import ${c.name}`} disabled={importing !== null} onClick={() => void runImport(c)}>
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
