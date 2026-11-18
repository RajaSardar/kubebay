import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function ResourceLink({
  kind,
  ns = "",
  name,
  children,
  href,
}: {
  kind: string;
  ns?: string;
  name: string;
  children?: ReactNode;
  /** Navigate here instead of the /detail route (e.g. a Helm release's page). */
  href?: string;
}) {
  const navigate = useNavigate();

  if (!name) return null;

  return (
    <span
      className="cell-link"
      onClick={(e) => {
        e.stopPropagation();
        navigate(href ?? `/detail/${kind}/${ns || "_"}/${name}`);
      }}
    >
      {children ?? name}
    </span>
  );
}
