import { useState, useMemo, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Modal, Stack, Row, Button, TextField, Badge, InlineBanner, Spinner } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { findCandidatePrometheusServices, suggestLocalURL, portForwardCommand } from "../lib/prometheusServiceDiscovery";
import * as api from "../lib/api";

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [command]);
  return (
    <div style={{ position: "relative", margin: "8px 0 0" }}>
      <pre
        className="mono"
        style={{
          fontSize: "var(--kb-text-xs)",
          whiteSpace: "pre-wrap",
          background: "var(--kb-bg-inset)",
          padding: "8px 40px 8px 8px",
          borderRadius: "var(--kb-radius-xs)",
          margin: 0,
          cursor: "pointer",
          userSelect: "all",
        }}
        onClick={copy}
      >
        {command}
      </pre>
      <Button
        onClick={copy}
        title="Copy to clipboard"
        variant="ghost"
       
        style={{
          position: "absolute",
          top: 4,
          right: 4,
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </Button>
    </div>
  );
}

interface ConfigurePrometheusModalProps {
  cluster: string;
  onClose: () => void;
  onSaved: () => void;
}

const ChoiceCard = ({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Button
    onClick={onClick}
    variant={selected ? "primary" : "ghost"}
    style={{
      padding: "12px 16px",
      textAlign: "left",
      width: "100%",
    }}
  >
    {children}
  </Button>
);

export default function ConfigurePrometheusModal({ cluster, onClose, onSaved }: ConfigurePrometheusModalProps) {
  const services = useResourceStream(cluster, "v1/services", { mode: "full", enabled: true });
  const candidates = useMemo(
    () => findCandidatePrometheusServices((services.rows ?? []) as Record<string, unknown>[]),
    [services.rows],
  );

  const [selectedIdx, setSelectedIdx] = useState<number | "manual" | null>(null);
  const [localUrl, setLocalUrl] = useState("");
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const current = await api.settingsApi.get();
      // Spread everything: the engine's save takes extraKubeconfigs and
      // onlyListedKubeconfigs from the body verbatim, so omitting them wipes them.
      const merged: api.AppSettings = {
        ...current,
        prometheusUrl: current.prometheusUrl || "",
        prometheusUrls: { ...(current.prometheusUrls || {}), [cluster]: localUrl },
      };
      await api.settingsApi.save(merged);
    },
    onSuccess: () => {
      setSaveErr(null);
      onSaved();
      onClose();
    },
    onError: () => {
      setSaveErr("Failed to save");
    },
  });

  const selectedCandidate = typeof selectedIdx === "number" ? candidates[selectedIdx] : null;

  const handleCandidateSelect = (idx: number) => {
    setSelectedIdx(idx);
    setLocalUrl(suggestLocalURL(candidates[idx]!));
    setSaveErr(null);
  };

  const handleManualSelect = () => {
    setSelectedIdx("manual");
    setLocalUrl("");
    setSaveErr(null);
  };

  const isSaveDisabled = !localUrl.trim() || mutation.isPending;

  return (
    <Modal label={`Configure Prometheus for ${cluster}`} onClose={onClose} placement="center">
      <Stack gap={4}>
        {!services.synced ? (
          <Spinner />
        ) : (
          <>
            {candidates.length > 0 && (
              <Stack gap={2}>
                <div style={{ fontSize: "var(--kb-text-sm)", fontWeight: "500" }}>Discovered Services</div>
                {candidates.map((candidate, idx) => (
                  <ChoiceCard key={candidate.address} selected={selectedIdx === idx} onClick={() => handleCandidateSelect(idx)}>
                    <Stack gap={1}>
                      <div>{candidate.name}</div>
                      <Badge>{candidate.namespace}</Badge>
                    </Stack>
                  </ChoiceCard>
                ))}
              </Stack>
            )}

            <ChoiceCard selected={selectedIdx === "manual"} onClick={handleManualSelect}>
              Manual
            </ChoiceCard>

            <Stack gap={2}>
              <label htmlFor="prometheus-url" style={{ fontSize: "var(--kb-text-sm)", fontWeight: "500" }}>
                URL
              </label>
              <TextField
                id="prometheus-url"
                placeholder="http://localhost:9090"
                value={localUrl}
                onChange={(e) => {
                  setLocalUrl(e.target.value);
                  setSaveErr(null);
                }}
              />
            </Stack>

            {selectedCandidate && (
              <Stack gap={2}>
                <div style={{ fontSize: "var(--kb-text-xs)", color: "var(--kb-fg-muted)" }}>
                  Run this command to set up port forwarding:
                </div>
                <CopyableCommand command={portForwardCommand(selectedCandidate)} />
              </Stack>
            )}

            {saveErr && <InlineBanner tone="err">{saveErr}</InlineBanner>}

            <Row gap={2} style={{ justifyContent: "flex-end", marginTop: "var(--kb-space-4)" }}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={isSaveDisabled}>
                Save
              </Button>
            </Row>
          </>
        )}
      </Stack>
    </Modal>
  );
}
