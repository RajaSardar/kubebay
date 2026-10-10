import { useCallback, useState } from "react";
import { Button } from "@kubebay/ui";

/** A command or config snippet the user pastes elsewhere, with a Copy button. */
export function CopyableCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [command]);
  return (
    <div style={{ position: "relative", margin: "8px 0 0" }}>
      <pre
        aria-label={label}
        className="mono"
        style={{
          fontSize: "var(--kb-text-xs)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          background: "var(--kb-bg-inset)",
          padding: "8px 72px 8px 8px",
          borderRadius: "var(--kb-radius-xs)",
          margin: 0,
          cursor: "pointer",
          userSelect: "all",
        }}
        onClick={copy}
      >
        {command}
      </pre>
      <Button onClick={copy} title="Copy to clipboard" variant="ghost" style={{ position: "absolute", top: 4, right: 4 }}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
