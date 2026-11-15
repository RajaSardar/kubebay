# Extensions

Kubebay reads `~/.kubebay/extensions.yaml` for extra **table columns** and **row actions** on any resource. You write the file yourself: Kubebay never writes it and never downloads one. It's read again each time you open a table or press Reload in Settings → Extensions, so edits apply without a restart.

Settings → Extensions shows the file's path, every entry Kubebay loaded, and what's wrong with any entry it skipped. A bad entry is skipped on its own; the rest of the file still loads.

Extensions are a desktop feature. They're off when the engine runs in-cluster or with OIDC, because the file would be the server's, not yours.

## The file

```yaml
version: 1          # optional; 1 is the only version
columns:
  - resource: deployments.apps
    header: Team
    jsonPath: .metadata.labels.team
actions:
  - resource: pods
    label: Describe
    run: kubectl describe pod --namespace {{namespace}} {{name}}
```

`resource` is the plural resource name, as kubectl takes it: `pods`, `deployments`, or with its API group, `deployments.apps`, `nodepools.karpenter.sh`. Without a group it matches that resource in any group.

### Columns

| Field | |
|---|---|
| `resource` | Which tables get the column. |
| `header` | The column's name, up to 40 characters. The filter targets it as `header-in-lowercase:value`. |
| `jsonPath` | What the column shows. Kubebay reads a subset of kubectl's JSONPath: `.a.b` keys, `\.` for a dot inside a key (`.metadata.labels.app\.kubernetes\.io/name`), `[N]` indexes, and `[?(@.type=="Ready")]` filters. The surrounding `{}` is optional. |

The column filters and sorts like any other. Tables that load only metadata (Services, ConfigMaps and others) load whole objects while a column reads past `.metadata`. A Secrets column can read only `.metadata`: Kubebay never loads Secret data into a table.

### Actions

| Field | |
|---|---|
| `resource` | Which tables' row menus get the action. |
| `label` | The menu item, up to 60 characters. |
| `url` | A link to open in your browser. It must start with `http://` or `https://`, and the host must be written out: values from the cluster can only go in the path and query. |
| `run` | A command to type into a local shell. It must be one line. |
| `contexts` | Optional. Kubeconfig contexts the action appears in; `*` matches anything (`prod-*`). |

Each action has either `url` or `run`, not both.

### Placeholders

`url` and `run` can use:

| Placeholder | Value |
|---|---|
| `{{name}}` | The object's name. |
| `{{namespace}}` | Its namespace. Cluster-scoped objects have none. |
| `{{kind}}` | Its kind, such as `Deployment`. |
| `{{context}}` | The kubeconfig context of the cluster you're looking at. |
| `{{label:KEY}}` | One of its labels, such as `{{label:app.kubernetes.io/name}}`. |
| `{{annotation:KEY}}` | One of its annotations. |

When a row doesn't have a value an action needs (a label it lacks, say), the action is greyed out in that row's menu and says which value is missing.

### How values are filled in

A **link**'s values are percent-encoded, so a value can't add a query parameter or change the path's shape. The scheme and host come from your template.

A **command** never runs by itself. Kubebay opens Terminal on the row's cluster and types the command at the prompt, without pressing Enter. You read it, then run it or clear the line. Each value is quoted as a single shell argument, so a name, label or annotation can't add a second command, whatever characters it holds:

```text
run: stern {{annotation:example.com/owner}}
annotation: x'; rm -rf ~; echo '
typed:      stern 'x'\''; rm -rf ~; echo '\'''
```

Because Kubebay quotes each value itself, a placeholder in a `run` template must stand outside quotes, and not right after `\` or `$`. `echo '{{name}}'` is refused with an error that says so. A value with a newline, an escape character or another control character, or a Unicode direction control, isn't typed at all: the action is greyed out with the reason.

Command actions need the local shell (the desktop app has it) and a shell Kubebay quotes for: `sh`, `bash`, `zsh`, `dash`, `ksh` or `fish`. Elsewhere they're hidden, and Settings says why.

### YAML tips

Templates with `{{` work as plain YAML values in the block style shown here. Inside a flow mapping (`{ … }`), or when a value starts with `{`, put it in quotes. YAML reads a bare `yes`, `no`, `on`, `off`, `Y` or `N` as true or false, so quote headers and labels like those.

## Examples

### A Grafana dashboard for a pod

```yaml
actions:
  - resource: pods
    label: Open in Grafana
    url: https://grafana.example.com/d/k8s-pod/pod?var-cluster={{context}}&var-namespace={{namespace}}&var-pod={{name}}
```

### Tail a workload's logs with stern

```yaml
actions:
  - resource: deployments
    label: Tail logs with stern
    run: stern --namespace {{namespace}} deployment/{{name}}
  - resource: statefulsets
    label: Tail logs with stern
    run: stern --namespace {{namespace}} statefulset/{{name}}
```

The local shell is already bound to the row's cluster, so stern and kubectl use it without `--context`.

### Open in Rancher, for clusters Kubebay can't link itself

Kubebay adds "Open in Rancher" by itself for contexts that go through Rancher's proxy (`https://<rancher>/k8s/clusters/<id>`). A context that reaches the cluster directly (an Authorized Cluster Endpoint) doesn't say which Rancher cluster it is, so write the link for it:

```yaml
actions:
  - resource: deployments
    label: Open in Rancher
    url: https://rancher.example.com/dashboard/c/c-m-4xk2p9/explorer/apps.deployment/{{namespace}}/{{name}}
    contexts: [prod-eu-ace]
  - resource: pods
    label: Open in Rancher
    url: https://rancher.example.com/dashboard/c/c-m-4xk2p9/explorer/pod/{{namespace}}/{{name}}
    contexts: [prod-eu-ace]
```

### Columns

```yaml
columns:
  - resource: deployments
    header: Team
    jsonPath: .metadata.labels.team
  - resource: deployments
    header: Image
    jsonPath: .spec.template.spec.containers[0].image
  - resource: pods
    header: Host IP
    jsonPath: .status.hostIP
  - resource: services
    header: App
    jsonPath: .metadata.labels.app\.kubernetes\.io/name
  - resource: nodepools.karpenter.sh
    header: Not ready because
    jsonPath: '{.status.conditions[?(@.type=="Ready")].reason}'
```
