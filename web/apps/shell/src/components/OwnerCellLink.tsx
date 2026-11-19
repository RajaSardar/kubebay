import { CellLink } from "@kubebay/ui";
import { useNavigate } from "react-router-dom";
import type { OwnerCell } from "../lib/ownerColumn";

/** The Owner column's cell: "Kind/name" linking to the owner's drawer, or a dash. */
export function OwnerCellLink({ cell }: { cell: OwnerCell }) {
  const navigate = useNavigate();
  const href = cell.href;
  if (!href) return <span className="muted">{cell.text}</span>;
  return (
    <CellLink
      href={href}
      title={cell.text}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(href);
      }}
    >
      {cell.text}
    </CellLink>
  );
}
