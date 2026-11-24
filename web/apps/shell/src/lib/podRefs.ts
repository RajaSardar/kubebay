/**
 * The Secrets and ConfigMaps a pod refers to: from env `valueFrom`, `envFrom`,
 * volumes (including projected ones) and imagePullSecrets. References only,
 * never a value: Secret data is not read here.
 */

type Obj = Record<string, unknown>;
const rec = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface EnvFromSource {
  kind: "Secret" | "ConfigMap";
  name: string;
  prefix: string;
  optional: boolean;
}

export interface ConfigRef {
  name: string;
  /** Where it is used, e.g. "env PASS (app)", "envFrom (app)", "volume tls", "imagePullSecrets". */
  uses: string[];
}

/** A container's `envFrom` sources. */
export function envFromSources(container: Obj): EnvFromSource[] {
  const out: EnvFromSource[] = [];
  for (const src of arr(container.envFrom)) {
    const prefix = str(src.prefix);
    const secret = rec(src.secretRef);
    const cm = rec(src.configMapRef);
    if (str(secret.name)) out.push({ kind: "Secret", name: str(secret.name), prefix, optional: secret.optional === true });
    else if (str(cm.name)) out.push({ kind: "ConfigMap", name: str(cm.name), prefix, optional: cm.optional === true });
  }
  return out;
}

export function podConfigRefs(pod: Obj): { secrets: ConfigRef[]; configMaps: ConfigRef[] } {
  const spec = rec(pod.spec);
  const secrets = new Map<string, string[]>();
  const configMaps = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, name: string, use: string) => {
    if (!name) return;
    const uses = m.get(name) ?? [];
    if (!uses.includes(use)) uses.push(use);
    m.set(name, uses);
  };

  for (const c of [...arr(spec.initContainers), ...arr(spec.containers)]) {
    const cname = str(c.name);
    for (const e of arr(c.env)) {
      const from = rec(e.valueFrom);
      add(secrets, str(rec(from.secretKeyRef).name), `env ${str(e.name)} (${cname})`);
      add(configMaps, str(rec(from.configMapKeyRef).name), `env ${str(e.name)} (${cname})`);
    }
    for (const s of envFromSources(c)) add(s.kind === "Secret" ? secrets : configMaps, s.name, `envFrom (${cname})`);
  }
  for (const v of arr(spec.volumes)) {
    const use = `volume ${str(v.name)}`;
    add(secrets, str(rec(v.secret).secretName), use);
    add(configMaps, str(rec(v.configMap).name), use);
    for (const src of arr(rec(v.projected).sources)) {
      add(secrets, str(rec(src.secret).name), use);
      add(configMaps, str(rec(src.configMap).name), use);
    }
  }
  for (const p of arr(spec.imagePullSecrets)) add(secrets, str(p.name), "imagePullSecrets");

  const list = (m: Map<string, string[]>): ConfigRef[] =>
    [...m.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, uses]) => ({ name, uses: uses.sort() }));
  return { secrets: list(secrets), configMaps: list(configMaps) };
}
