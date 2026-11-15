/**
 * Space for the rows of a virtualised table that are not mounted. It must be
 * a real <tr> with a height: browsers ignore padding and margin on <tbody>
 * and <tr> (only cells honour it), so padding on the row group never grows
 * the scroll area and the list stops a few rows deep.
 */
export function VirtualSpacer({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden style={{ height }}>
      <td style={{ padding: 0, border: "none" }} colSpan={colSpan} />
    </tr>
  );
}
