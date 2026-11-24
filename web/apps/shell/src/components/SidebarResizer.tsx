import { ResizeHandle } from "@kubebay/ui";
import { SIDEBAR_COLLAPSE_BELOW, SIDEBAR_DEFAULT_W, SIDEBAR_MAX_W, SIDEBAR_MIN_W, type SidebarState } from "../lib/useSidebar";

/** The draggable right edge of the left nav. Dragging far enough left collapses it; the width is kept. */
export function SidebarResizer({ sidebar }: { sidebar: SidebarState }) {
  if (sidebar.hidden) return null;
  return (
    <ResizeHandle
      className="sidebar-resize"
      label="Resize the sidebar"
      grow="right"
      value={sidebar.width}
      min={SIDEBAR_MIN_W}
      max={SIDEBAR_MAX_W}
      defaultValue={SIDEBAR_DEFAULT_W}
      collapseBelow={SIDEBAR_COLLAPSE_BELOW}
      onChange={sidebar.setWidth}
      onReset={sidebar.resetWidth}
      onCollapse={sidebar.hide}
    />
  );
}
