---
title: Extensions
description: Add your own table columns and row actions, such as a Grafana link or a stern command, from one YAML file.
section: Integrations
order: 1
appRoutes: []
---

Kubebay reads `~/.kubebay/extensions.yaml` for extra **table columns** and **row actions** on any resource. You write the file yourself. Kubebay never writes one or downloads one. It reads the file again each time you open a table, or when you click **Reload** in [Settings → Extensions](/docs/settings/#extensions), so your edits apply without a restart.

**Settings → Extensions** shows the file's path, every entry Kubebay loaded, and what's wrong with any entry it skipped. A bad entry is skipped on its own, and the rest of the file still loads.

Extensions are a desktop feature. They're off when the engine runs in a cluster or with OIDC, because the file would be the server's, not yours.

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

`resource` is the plural resource name, as `kubectl` takes it: `pods`, `deployments`, or with its API group, such as `deployments.apps` or `nodepools.karpenter.sh`. Without a group it matches that resource in any group.

## Columns

| Field | |
|---|---|
| `resource` | Which tables get the column |
| `header` | The column's name, up to 40 characters. The filter targets it as `header-in-lowercase:value` |
| `jsonPath` | What the column shows. Kubebay reads a subset of kubectl's JSONPath: `.a.b` keys, `\.` for a dot inside a key, `[N]` indexes, and `[?(@.type=="Ready")]` filters. The surrounding `{}` is optional |

A column filters and sorts like any other. A Secrets column can read only `.metadata`, because Kubebay never loads Secret data into a table.

## Actions

| Field | |
|---|---|
| `resource` | Which tables' row menus get the action |
| `label` | The menu item, up to 60 characters |
| `url` | A link to open in your browser. It must start with `http://` or `https://`, and the host must be written out. Values from the cluster can only go in the path and query |
| `run` | A command to type into the [Terminal](/docs/terminal/). It must be one line |
| `contexts` | Optional. The kubeconfig contexts the action appears in. `*` matches anything, as in `prod-*` |

Each action has either `url` or `run`, not both.

### Placeholders

| Placeholder | Value |
|---|---|
| `{{name}}` | The object's name |
| `{{namespace}}` | Its namespace. Cluster-scoped objects have none |
| `{{kind}}` | Its kind, such as `Deployment` |
| `{{context}}` | The kubeconfig context of the cluster you're looking at |
| `{{label:KEY}}` | One of its labels, such as `{{label:app.kubernetes.io/name}}` |
| `{{annotation:KEY}}` | One of its annotations |

When a row doesn't have a value an action needs, such as a label it lacks, the action is greyed out in that row's menu and says which value is missing.

### How values are filled in

A **link**'s values are percent-encoded, so a value can't add a query parameter or change the path. The scheme and host come from your template.

A **command** never runs by itself. Kubebay opens the Terminal on the row's cluster and types the command at the prompt, without pressing <kbd>Enter</kbd>. Each value is quoted as one shell argument, so a name, label or annotation can't add a second command, whatever characters it holds.

Because Kubebay quotes each value itself, a placeholder in a `run` template must stand outside quotes, and not right after `\` or `$`. `echo '{{name}}'` is refused with an error that says so. A value with a newline or another control character isn't typed at all: the action is greyed out with the reason.

Command actions need the local terminal (the desktop app has it) and a shell Kubebay knows how to quote for: `sh`, `bash`, `zsh`, `dash`, `ksh` or `fish`. Elsewhere they're hidden, and Settings says why.

## Examples

A Grafana dashboard for a pod:

```yaml
actions:
  - resource: pods
    label: Open in Grafana
    url: https://grafana.example.com/d/k8s-pod/pod?var-cluster={{context}}&var-namespace={{namespace}}&var-pod={{name}}
```

Tail a workload's logs with stern. The terminal is already bound to the row's cluster, so no `--context` is needed:

```yaml
actions:
  - resource: deployments
    label: Tail logs with stern
    run: stern --namespace {{namespace}} deployment/{{name}}
```

More columns:

```yaml
columns:
  - resource: deployments
    header: Image
    jsonPath: .spec.template.spec.containers[0].image
  - resource: pods
    header: Host IP
    jsonPath: .status.hostIP
  - resource: nodepools.karpenter.sh
    header: Not ready because
    jsonPath: '{.status.conditions[?(@.type=="Ready")].reason}'
```

YAML reads a bare `yes`, `no`, `on`, `off`, `Y` or `N` as true or false, so quote headers and labels like those. Put a value that starts with `{` in quotes.
