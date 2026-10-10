import { useEffect, useState, useMemo, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Modal, Stack, Row, Button, TextField, ChoiceCard, NsPill, InlineBanner, Spinner } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { findCandidatePrometheusServices, rankPrometheusServers, suggestLocalURL, portForwardCommand } from "../lib/prometheusServiceDiscovery";
import * as api from "../lib/api";
import { CopyableCommand } from "./CopyableCommand";

interface ConfigurePrometheusModalProps {
  cluster: string;
  /**
   * Whether the cluster is connected. Looking for its Prometheus services
   * opens a stream, which would connect it; a URL typed by hand needs no
   * connection, so a cluster that isn't connected only gets the field.
   * Default true (the pod graphs open this for the cluster in use).
   */
  connected?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function ConfigurePrometheusModal({ cluster, connected = true, onClose, onSaved }: ConfigurePrometheusModalProps) {
  const services = useResourceStream(cluster, "v1/services", { mode: "full", enabled: connected });
  const candidates = useMemo(
    () => rankPrometheusServers(findCandidatePrometheusServices((services.rows ?? []) as Record<string, unknown>[])),
    [services.rows],
  );
  // The URL this cluster uses now, and the default it falls back to.
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.settingsApi.get()) ?? null, retry: false });
  const current = settings.data?.prometheusUrls?.[cluster] ?? "";
  const fallback = settings.data?.prometheusUrl ?? "";

  const [selectedIdx, setSelectedIdx] = useState<number | "manual" | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [edited, setEdited] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Start from the URL already set, unless the user has typed or picked one.
  useEffect(() => {
    if (!edited && current) setLocalUrl(current);
  }, [current, edited]);

  const mutation = useMutation({
    mutationFn: async () => {
      const latest = await api.settingsApi.get();
      const urls = { ...(latest.prometheusUrls || {}) };
      const url = localUrl.trim();
      // An empty field removes this cluster's own URL, so it uses the default again.
      if (url) urls[cluster] = url;
      else delete urls[cluster];
      // Spread everything: the engine's save takes extraKubeconfigs and
      // onlyListedKubeconfigs from the body verbatim, so omitting them wipes them.
      const merged: api.AppSettings = { ...latest, prometheusUrl: latest.prometheusUrl || "", prometheusUrls: urls };
      await api.settingsApi.save(merged);
    },
    onSuccess: () => {
      setSaveErr(null);
      onSaved();
      onClose();
    },
    onError: (e) => {
      setSaveErr(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    },
  });

  const selectedCandidate = typeof selectedIdx === "number" ? candidates[selectedIdx] : null;

  const edit = (url: string) => {
    setLocalUrl(url);
    setEdited(true);
    setSaveErr(null);
  };

  const handleCandidateSelect = (idx: number) => {
    setSelectedIdx(idx);
    edit(suggestLocalURL(candidates[idx]!));
  };

  const handleManualSelect = () => {
    setSelectedIdx("manual");
    edit("");
  };

  // Empty is a valid save only when it removes a URL this cluster has.
  const isSaveDisabled = mutation.isPending || (!localUrl.trim() && !current);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isSaveDisabled) mutation.mutate();
  };

  return (
    <Modal
      label={`Configure Prometheus for ${cluster}`}
      title={`Configure Prometheus for ${cluster}`}
      onClose={onClose}
      placement="center"
      size="wide"
    >
      <form onSubmit={submit}>
        <Stack gap={4}>
          {!connected ? (
            <span className="muted small">Connect to this cluster to look for its Prometheus services.</span>
          ) : !services.synced ? (
            <Row gap={2} align="center" role="status">
              <Spinner label={null} size={14} />
              <span className="muted small">Looking for Prometheus services…</span>
            </Row>
          ) : candidates.length === 0 ? (
            <span className="muted small">No Prometheus services found in this cluster.</span>
          ) : (
            <Stack gap={2}>
              <strong className="small">Prometheus services in this cluster</strong>
              {candidates.map((candidate, idx) => (
                <ChoiceCard key={candidate.address} selected={selectedIdx === idx} onClick={() => handleCandidateSelect(idx)}>
                  <span>{candidate.name}</span>
                  <NsPill>{candidate.namespace}</NsPill>
                </ChoiceCard>
              ))}
              <ChoiceCard selected={selectedIdx === "manual"} onClick={handleManualSelect}>
                Manual
              </ChoiceCard>
            </Stack>
          )}

          <Stack gap={2}>
            <label htmlFor="prometheus-url" className="small">
              <strong>URL</strong>
            </label>
            <TextField
              id="prometheus-url"
              placeholder={fallback || "http://localhost:9090"}
              value={localUrl}
              onChange={(e) => edit(e.target.value)}
            />
            {fallback && <span className="muted small">Leave it empty to use the default.</span>}
          </Stack>

          {selectedCandidate && (
            <Stack gap={2}>
              <span className="muted small">Run this command to set up port forwarding:</span>
              <CopyableCommand command={portForwardCommand(selectedCandidate)} />
            </Stack>
          )}

          {saveErr && (
            <InlineBanner tone="err" flush>
              {saveErr}
            </InlineBanner>
          )}

          <Row gap={2} justify="end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaveDisabled}>
              Save
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}
