import { useAgeLabel } from "../lib/tableUx";

/** A table's Age cell text: keeps counting while the row itself is unchanged. */
export function LiveAge({ ts }: { ts: string | undefined }) {
  return <>{useAgeLabel(ts)}</>;
}
