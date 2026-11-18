import { Button, InlineBanner, Row } from "@kubebay/ui";
import { YamlTab } from "./heavy";
import { useDiscardGuard } from "./DiscardGuard";
import { editTabKey, useTerminalDock } from "../lib/terminalDock";
import type { GitOpsOwner } from "../lib/gitops";

/**
 * The drawer's YAML tab. The drawer editor stays the default; "Open in bottom
 * dock" moves the edit to a dock tab (backlog 51). While that tab is open the
 * drawer shows a pointer to it instead of a second live editor for the object.
 */
export function DrawerYaml(props: {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  gitopsOwner?: GitOpsOwner | null;
  helmRelease?: string | null;
}) {
  const key = editTabKey(props);
  const inDock = useTerminalDock((s) => s.tabs.some((t) => t.key === key));
  const { guard, modal } = useDiscardGuard();

  if (inDock) {
    const goTo = () => {
      const d = useTerminalDock.getState();
      d.focusTab(key);
      d.openDock({ focus: false });
    };
    return (
      <InlineBanner
        flush
        actions={
          <Button variant="ghost" onClick={goTo}>
            Go to tab
          </Button>
        }
      >
        <strong>Editing in dock.</strong> This object is open as a YAML tab in the bottom dock, so there is no second editor here.
      </InlineBanner>
    );
  }

  const openInDock = guard(() => useTerminalDock.getState().openEditTab(props));
  return (
    <>
      <Row justify="end">
        <Button variant="ghost" size="sm" onClick={openInDock}>
          Open in bottom dock
        </Button>
      </Row>
      <YamlTab {...props} />
      {modal}
    </>
  );
}
