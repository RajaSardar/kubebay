import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function ResourceLink({
  kind,
  ns = "",
  name,
  children,
}: {
  kind: string;
  ns?: string;
  name: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();

  if (!name) return null;

  return (
    <span
      className="cell-link"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/detail/${kind}/${ns || "_"}/${name}`);
      }}
    >
      {children ?? name}
    </span>
  );
}
