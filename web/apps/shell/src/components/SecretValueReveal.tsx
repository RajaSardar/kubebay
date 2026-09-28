import { useState } from "react";
import { Button } from "@kubebay/ui";
import { secretApi } from "../lib/api";

// Masked env-var value backed by a `secretKeyRef`. Never fetches or decodes
// until the user explicitly clicks Show -- every successful reveal is
// audited engine-side (see HandleGetSecretValue).
export function SecretValueReveal({
  cluster,
  ns,
  name,
  secretKey,
}: {
  cluster: string;
  ns: string;
  name: string;
  secretKey: string;
}) {
  const [state, setState] = useState<{ status: "hidden" | "loading" | "shown" | "error"; value?: string; error?: string }>({
    status: "hidden",
  });

  async function reveal() {
    setState({ status: "loading" });
    try {
      const { value } = await secretApi.revealValue({ cluster, ns, name, key: secretKey });
      setState({ status: "shown", value });
    } catch (e) {
      setState({ status: "error", error: String(e instanceof Error ? e.message : e) });
    }
  }

  if (state.status === "shown") {
    return <span className="mono small">{state.value}</span>;
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="mono small muted">{`secret(${name})[${secretKey}]`}</span>
      <Button variant="ghost" disabled={state.status === "loading"} onClick={() => void reveal()}>
        {state.status === "loading" ? "Loading…" : "Show"}
      </Button>
      {state.status === "error" && <span className="error-text small">{state.error}</span>}
    </span>
  );
}
