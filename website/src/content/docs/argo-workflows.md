---
title: Argo Workflows
description: Argo Workflows, their phase, progress and node tree, with WorkflowTemplates, ClusterWorkflowTemplates and CronWorkflows, and Stop, Suspend, Resume and Resubmit.
section: Integrations
order: 20
appRoutes: ["/argo-workflows"]
---

**Argo Workflows** in the sidebar's Tools lists the cluster's Argo Workflows objects. If none of the `argoproj.io` kinds `workflows`, `workflowtemplates`, `clusterworkflowtemplates` or `cronworkflows` exists on the cluster, the page says so. Kubebay reads the objects through the Kubernetes API, so it needs no login to Argo's own server.

The namespace filter at the top of the app applies: the page lists the workflows, templates and CronWorkflows of the selected namespaces. ClusterWorkflowTemplates aren't namespaced, so they always show.

A row of buttons picks the kind: **Workflows**, **WorkflowTemplates**, **ClusterWorkflowTemplates** and **CronWorkflows**, each with its count.

## Workflows

One row per workflow, newest first:

- **Phase**, as a pill: Pending, Running, Succeeded, Failed or Error. A workflow the controller hasn't picked up yet shows Pending;
- **Progress**, `done/total` from the workflow's own progress, or the count of finished pod steps when Argo hasn't reported one;
- **Duration**, from start to finish, or to now while it runs;
- **Started**, how long ago.

Click a row to open its detail above the list.

### Node tree

The detail lists the workflow's steps from its status, indented the way they nest (DAG tasks, steps, retries). For each node: its type, its phase, the **Pod** that ran it and its message, such as the reason a step failed. The Pod links to its page. Kubebay finds the pod by the labels and annotations Argo puts on it; a node whose pod is gone, or that has no pod (a DAG or Steps node), shows a dash. A step that several others depend on appears once, under the first.

**Open YAML** opens the workflow's own page.

### Actions

Each action asks you to click twice, and the second click carries it out. A production-looking cluster also shows a warning. Every action is audit-logged and uses your own permissions, like an edit in the YAML editor.

- **Stop** sets `spec.shutdown` to `Stop`: Argo stops starting new steps and runs the workflow's exit handlers. Shown while the workflow is Running or Pending.
- **Terminate** sets `spec.shutdown` to `Terminate`: Argo kills running steps and skips the exit handlers.
- **Suspend** sets `spec.suspend` to `true`, so no new steps start; **Resume** clears it again. This is the workflow-level switch. A step that is itself a suspend template, waiting for approval, isn't resumed from here.
- **Resubmit** creates a **new** workflow from the old one's spec, with a `generateName` taken from the old workflow's name, so the API server picks a new name. The copy leaves out `spec.shutdown` and `spec.suspend`, so it runs, and leaves out the status and Argo's own labels and annotations. It's marked with the annotation `kubebay.dev/resubmitted-from`. It's available on every workflow, finished or not. The old workflow is untouched.

There's no **Retry**. Argo implements it by rewriting the workflow's node status, which isn't a safe edit to make from here. Use `argo retry`.

## WorkflowTemplates and ClusterWorkflowTemplates

Each template's name (linked to its own page), namespace, entrypoint, how many templates it holds and when it was created.

## CronWorkflows

For each CronWorkflow: its schedule, time zone (UTC when none is set), the next run, when it last ran, how many workflows it has running, and an **Active** or **Suspended** pill. A CronWorkflow with several `schedules` shows all of them and the earliest next run. Hover the next run for its date in the CronWorkflow's time zone. A suspended CronWorkflow has no next run.

**Suspend** and **Resume** set `spec.suspend` on the CronWorkflow, with the same two-click confirmation and audit log.

See also [Argo Events](/docs/argo-events/), whose Sensors start workflows, and [Argo CD](/docs/argocd/).
