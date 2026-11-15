import { IconButton } from "@kubebay/ui";
import { IconSidebar } from "@kubebay/ui/src/icons";
import type { SidebarState } from "../lib/useSidebar";

const SHORTCUT = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘B" : "Ctrl+B";

/** In the left nav's top row: hides the whole nav. */
export function HideSidebarButton({ sidebar }: { sidebar: SidebarState }) {
  return (
    <IconButton
      ref={sidebar.hideRef}
      label="Hide sidebar"
      title={`Hide sidebar (${SHORTCUT})`}
      aria-controls="kb-sidebar"
      aria-expanded={true}
      className="sidebar-toggle"
      onClick={sidebar.hide}
    >
      <IconSidebar size={15} />
    </IconButton>
  );
}

/** On the cluster rail while the nav is hidden: brings it back. */
export function ShowSidebarButton({ sidebar }: { sidebar: SidebarState }) {
  return (
    <IconButton
      ref={sidebar.showRef}
      label="Show sidebar"
      title={`Show sidebar (${SHORTCUT})`}
      aria-controls="kb-sidebar"
      aria-expanded={false}
      className="sidebar-toggle"
      onClick={sidebar.show}
    >
      <IconSidebar size={15} />
    </IconButton>
  );
}
