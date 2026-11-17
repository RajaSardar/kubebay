import { useMemo, useState } from "react";
import { Badge, Button, CollapsibleSection, Row, TextField } from "@kubebay/ui";
import type { RBACRule, RBACSnapshot } from "../lib/api";

const PAGE = 50;

type Role = RBACSnapshot["roles"][number];
type Binding = RBACSnapshot["roleBindings"][number];
type Subject = Binding["subjects"][number];

const wild = (xs: string[] | null | undefined) => (xs ?? []).includes("*");
const subjectLabel = (s: Subject) => (s.kind === "ServiceAccount" ? `SA ${s.ns ?? ""}/${s.name}` : `${s.kind} ${s.name}`);

function Chips({ items }: { items: string[] }) {
  return (
    <>
      {items.map((x) => (
        <Badge key={x} {...(x === "*" ? { tone: "warn" as const, title: "Wildcard: matches everything" } : {})}>
          {x}
        </Badge>
      ))}
    </>
  );
}

function RuleLine({ rule }: { rule: RBACRule }) {
  const verbs = rule.verbs ?? [];
  const resources = rule.resources ?? [];
  const groups = rule.apiGroups ?? [];
  const names = rule.resourceNames ?? [];
  const urls = rule.nonResourceURLs ?? [];
  return (
    <Row wrap gap={1} align="center">
      <Chips items={verbs} />
      {resources.length > 0 && (
        <>
          <span className="muted small">on</span>
          <Chips items={resources} />
          <span className="muted small">in</span>
          <Chips items={groups.map((g) => (g === "" ? "core" : g))} />
        </>
      )}
      {names.length > 0 && (
        <>
          <span className="muted small">named</span>
          <Chips items={names} />
        </>
      )}
      {urls.length > 0 && (
        <>
          <span className="muted small">URLs</span>
          <Chips items={urls} />
        </>
      )}
      {wild(verbs) && wild(resources) && <Badge tone="err">full access</Badge>}
    </Row>
  );
}

function RoleRow({ role, subjects }: { role: Role; subjects: Subject[] }) {
  const [open, setOpen] = useState(false);
  const hasWildcard = role.rules.some((r) => wild(r.verbs) || wild(r.resources));
  return (
    <CollapsibleSection
      level="sub"
      open={open}
      onToggle={() => setOpen((o) => !o)}
      count={role.rules.length}
      title={
        <>
          <span className="mono">{role.name}</span> {role.ns ? <Badge>{role.ns}</Badge> : <Badge tone="info">cluster</Badge>}{" "}
          {hasWildcard && <Badge tone="warn">wildcard</Badge>}
        </>
      }
    >
      <div className="muted small">Rules</div>
      {role.rules.length === 0 ? <div className="muted small">No rules.</div> : role.rules.map((r, i) => <RuleLine key={i} rule={r} />)}
      <div className="muted small" style={{ marginTop: 8 }}>
        Bound to
      </div>
      {subjects.length === 0 ? (
        <div className="muted small">No bindings reference this role.</div>
      ) : (
        <Row wrap gap={1}>
          {subjects.map((s, i) => (
            <Badge key={i}>{subjectLabel(s)}</Badge>
          ))}
        </Row>
      )}
    </CollapsibleSection>
  );
}

export function roleCount(rbac: RBACSnapshot): number {
  return rbac.roles.length + rbac.clusterRoles.length;
}

/** Every Role and ClusterRole, filterable, each expandable to its rules and who is bound to it. */
export function RbacRolesList({ rbac }: { rbac: RBACSnapshot }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const boundTo = useMemo(() => {
    const m = new Map<string, Subject[]>();
    for (const b of [...rbac.clusterRoleBindings, ...rbac.roleBindings]) {
      const [kind, name] = b.roleRef.split(":");
      const key = kind === "ClusterRole" ? `ClusterRole::${name}` : `Role:${b.ns ?? ""}:${name}`;
      m.set(key, [...(m.get(key) ?? []), ...(b.subjects ?? [])]);
    }
    return m;
  }, [rbac.clusterRoleBindings, rbac.roleBindings]);

  const all = useMemo(
    () => [...rbac.clusterRoles, ...rbac.roles].sort((a, b) => a.name.localeCompare(b.name) || (a.ns ?? "").localeCompare(b.ns ?? "")),
    [rbac.clusterRoles, rbac.roles],
  );
  const needle = q.trim().toLowerCase();
  const filtered = needle ? all.filter((r) => `${r.ns ?? ""}/${r.name}`.toLowerCase().includes(needle)) : all;
  const keyOf = (r: Role) => (r.ns ? `Role:${r.ns}:${r.name}` : `ClusterRole::${r.name}`);

  return (
    <div>
      <TextField
        placeholder="Filter roles by name or namespace"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShown(PAGE);
        }}
        spellCheck={false}
        aria-label="Filter roles"
      />
      <div style={{ marginTop: 10 }}>
        {filtered.length === 0 && <div className="muted small">No roles match.</div>}
        {filtered.slice(0, shown).map((r) => (
          <RoleRow key={keyOf(r)} role={r} subjects={boundTo.get(keyOf(r)) ?? []} />
        ))}
        {filtered.length > shown && (
          <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({filtered.length - shown} left)
          </Button>
        )}
      </div>
    </div>
  );
}
