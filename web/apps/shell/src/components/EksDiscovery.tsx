import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, DataTable, InlineBanner, Row, Select, SkeletonLines, Stack, TextField } from "@kubebay/ui";
import { cloudDiscoveryApi, type DiscoveredEksCluster } from "../lib/api";

type ScanResult = Awaited<ReturnType<typeof cloudDiscoveryApi.scan>>;

/**
 * Backlog #14: find EKS clusters your own aws CLI can see and add one with a
 * click. Nothing runs until asked. An import writes a kubeconfig Kubebay owns
 * (~/.kubebay/discovered) and never touches your own.
 */
export function EksDiscovery() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const profiles = useQuery({ queryKey: ["aws-profiles"], queryFn: cloudDiscoveryApi.profiles, enabled: open, staleTime: 5 * 60_000, retry: false });
  const [profile, setProfile] = useState<string | null>(null);
  const [regions, setRegions] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [imported, setImported] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState<string | null>(null);

  // Default to the "default" profile when there is one, else the first.
  useEffect(() => {
    if (profile !== null || !profiles.data) return;
    const first = profiles.data.find((p) => p.name === "default") ?? profiles.data[0];
    setProfile(first?.name ?? "");
    setRegions(first?.region ?? "");
  }, [profiles.data, profile]);

  function chooseProfile(name: string) {
    setProfile(name);
    setRegions(profiles.data?.find((p) => p.name === name)?.region ?? "");
    setScan(null);
  }

  const regionList = regions
    .split(/[\s,]+/)
    .map((r) => r.trim())
    .filter(Boolean);

  async function runScan() {
    setBusy(true);
    setErr("");
    try {
      setScan(await cloudDiscoveryApi.scan(profile ?? "", regionList));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport(c: DiscoveredEksCluster) {
    setImporting(c.arn);
    setErr("");
    try {
      await cloudDiscoveryApi.importEks(profile ?? "", c.region, c.name);
      setImported((m) => ({ ...m, [c.arn]: true }));
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
          Find EKS clusters
        </Button>
        <span className="muted small">Lists the EKS clusters your aws CLI can see, so you can add one without editing a kubeconfig.</span>
      </Row>
    );
  }

  return (
    <Stack gap={3}>
      <strong>EKS clusters</strong>
      <div className="muted small">
        Runs your own aws CLI with your own credentials (eks:ListClusters and eks:DescribeCluster in each region you list),
        only when you scan. Importing writes a kubeconfig Kubebay owns, in ~/.kubebay/discovered, that signs in with
        aws eks get-token; your own kubeconfig is never changed.
      </div>
      {profiles.isLoading && <SkeletonLines lines={2} label="Reading AWS profiles…" />}
      {profiles.error && <InlineBanner flush>{profiles.error instanceof Error ? profiles.error.message : String(profiles.error)}</InlineBanner>}
      {profiles.data && (
        <Row gap={2} align="center" wrap>
          <Select aria-label="AWS profile" value={profile ?? ""} onChange={(e) => chooseProfile(e.target.value)}>
            {profiles.data.length === 0 && <option value="">default credentials</option>}
            {profiles.data.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
          <TextField
            aria-label="AWS regions"
            placeholder="regions, e.g. eu-west-1, us-east-1"
            value={regions}
            onChange={(e) => setRegions(e.target.value)}
            style={{ minWidth: 0, flex: "1 1 240px" }}
          />
          <Button disabled={busy || regionList.length === 0} onClick={() => void runScan()}>
            {busy ? "Scanning…" : "Scan"}
          </Button>
        </Row>
      )}
      {err && <InlineBanner flush>{err}</InlineBanner>}
      {scan && scan.errors.length > 0 && (
        <InlineBanner tone="warn" flush>
          <Stack gap={1}>
            {scan.errors.map((e) => (
              <span key={`${e.region}/${e.cluster ?? ""}`}>{`${e.region}${e.cluster ? ` ${e.cluster}` : ""}: ${e.message}`}</span>
            ))}
          </Stack>
        </InlineBanner>
      )}
      {scan && (
        <DataTable
          rows={scan.clusters}
          rowKey={(c) => c.arn}
          empty={<div className="muted small">No EKS clusters in these regions.</div>}
          columns={[
            { key: "name", header: "Cluster", className: "mono small strong", render: (c) => c.name },
            { key: "region", header: "Region", className: "mono small", render: (c) => c.region },
            { key: "account", header: "Account", className: "mono small", render: (c) => c.account ?? "—" },
            { key: "version", header: "Version", className: "mono small", render: (c) => c.version ?? "—" },
            { key: "status", header: "Status", className: "small", render: (c) => c.status ?? "—" },
            {
              key: "action",
              header: "",
              render: (c) =>
                c.imported ? (
                  <Badge>in your kubeconfig</Badge>
                ) : imported[c.arn] ? (
                  <Badge tone="ok">imported</Badge>
                ) : (
                  <Button variant="ghost" disabled={importing !== null} onClick={() => void runImport(c)}>
                    {importing === c.arn ? "Importing…" : "Import"}
                  </Button>
                ),
            },
          ]}
        />
      )}
    </Stack>
  );
}
