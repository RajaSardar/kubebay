import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@kubebay/ui";
import { authMode, checkToken, getToken, setToken } from "../lib/api";

type Phase = "checking" | "ready" | "needed";

/**
 * Holds the app back until it has a credential to work with.
 *
 * The desktop app injects the token before the page loads, so this resolves
 * immediately there. It only ever asks a human when Kubebay is opened in a
 * plain browser against a token-protected engine — the dev/`--web-dist` flow,
 * where the token is no longer in the URL and no longer in the engine's log.
 */
export function TokenGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(getToken() ? "ready" : "checking");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase !== "checking") return;
    let cancelled = false;
    authMode()
      .then((mode) => {
        if (!cancelled) setPhase(mode === "token" ? "needed" : "ready");
      })
      // Engine unreachable: let the app render and show its own error rather
      // than blaming the user for a token they cannot fix.
      .catch(() => {
        if (!cancelled) setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (phase === "ready") return <>{children}</>;
  if (phase === "checking") return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      if (await checkToken(token)) {
        setToken(token);
        setPhase("ready");
      } else {
        setError("That token was rejected by the engine.");
      }
    } catch {
      setError("Could not reach the engine.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="token-gate">
      <form className="token-gate-card" onSubmit={submit}>
        <h1>Connect to the Kubebay engine</h1>
        <p className="muted small">
          Paste the session token. The engine writes it to <code>session-token</code> in your config
          directory and logs that path on startup.
        </p>
        <input
          type="password"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={value}
          placeholder="session token"
          onChange={(e) => setValue(e.target.value)}
          aria-label="session token"
        />
        {error && <p className="token-gate-error">{error}</p>}
        <Button disabled={busy || !value.trim()}>{busy ? "Checking…" : "Connect"}</Button>
      </form>
    </div>
  );
}
