import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@kubebay/ui";
import { IconRefresh } from "@kubebay/ui/src/icons";
import { IS_MAC, refreshAll } from "../lib/refreshAll";

/** Refetches every query and re-subscribes every stream; same as ⌘R / Ctrl+R. */
export function RefreshButton({ className }: { className?: string }) {
  const qc = useQueryClient();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => refreshAll(qc)}
      title={`Refresh everything (${IS_MAC ? "⌘R" : "Ctrl+R"})`}
    >
      <IconRefresh size={12} />
      Refresh
    </Button>
  );
}
