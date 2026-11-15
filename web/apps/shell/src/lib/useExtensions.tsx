import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { MenuItem } from "@kubebay/ui";
import type { ListColumn } from "../components/ResourceListView";
import { extensionsApi } from "./api";
import { actionsFor, columnsFor, expandRun, expandURL, varsOf, type ResourceRef } from "./extensions";
import { evalPrinterPath } from "./printerPath";

/** What the terminal page is handed to type into a new local shell. */
export interface ShellPrefill {
  cluster: string;
  command: string;
  label: string;
}

/** The engine reads the file on every request, so a refetch picks up an edit. */
export function useExtensionsFile() {
  return useQuery({ queryKey: ["extensions"], queryFn: extensionsApi.get, staleTime: 30_000, retry: false });
}

const filterKeyOf = (header: string) => header.toLowerCase().replace(/\s+/g, "-");
const onlyMetadata = (path: string) => /^\{?\s*\.metadata\./.test(path);

/**
 * KB-13: a table's extension columns and row actions. `objectOf` gives the raw
 * Kubernetes object behind a row.
 */
export function useExtensions<R>(
  def: (ResourceRef & { kind: string; slug?: string }) | undefined,
  cluster: string,
  context: string,
  objectOf: (r: R) => unknown,
) {
  const file = useExtensionsFile().data;
  const navigate = useNavigate();
  const resource = def?.resource;
  const group = def?.group ?? "";

  const cols = useMemo(() => (resource ? columnsFor(file, { resource, group }) : []), [file, resource, group]);
  const actions = useMemo(
    () => (resource ? actionsFor(file, { resource, group }, context) : []),
    [file, resource, group, context],
  );

  const columns = useMemo<ListColumn<R>[]>(
    () =>
      cols.map((c): ListColumn<R> => {
        const text = (r: R) => evalPrinterPath(c.jsonPath, objectOf(r));
        return {
          id: `ext:${c.header}`,
          header: c.header,
          cell: (r: R) => text(r) || <span className="muted">–</span>,
          sortValue: text,
          filterText: text,
          filterKey: filterKeyOf(c.header),
        };
      }),
    [cols, objectOf],
  );

  // A metadata-only table (Services, ConfigMaps…) loads whole objects only when
  // a column reads past metadata. Secrets never do: their data stays out of tables.
  const needsFull = resource !== "secrets" && cols.some((c) => !onlyMetadata(c.jsonPath));

  const menuItems = (r: R): MenuItem[] => {
    if (!def || actions.length === 0) return [];
    const vars = varsOf(objectOf(r), def.kind, context);
    const items: MenuItem[] = actions.map((a) => {
      if (a.url !== undefined) {
        const url = expandURL(a.url, vars);
        return url.ok
          ? { label: a.label, hint: url.value, onClick: () => void window.open(url.value, "_blank", "noopener,noreferrer") }
          : { label: a.label, disabled: true, hint: url.reason, onClick: () => {} };
      }
      const cmd = expandRun(a.run ?? "", vars);
      if (!cmd.ok) return { label: a.label, disabled: true, hint: cmd.reason, onClick: () => {} };
      const prefill: ShellPrefill = { cluster, command: cmd.value, label: a.label };
      return { label: a.label, hint: `Types into a local shell: ${cmd.value}`, onClick: () => navigate("/terminal", { state: { prefill } }) };
    });
    return [{ separator: true, label: "", onClick: () => {} }, ...items];
  };

  return { columns, needsFull, menuItems };
}
