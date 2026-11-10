---
title: KEDA
description: Every KEDA object in a searchable table, which are paused, which fight an HPA, unused TriggerAuthentications, and a wizard for new ScaledObjects.
section: Integrations
order: 6
appRoutes: ["/keda"]
---

**KEDA** in the sidebar's Tools lists the cluster's KEDA objects, one tab for each kind KEDA installed: **ScaledObjects**, **ScaledJobs**, **TriggerAuthentications** and **ClusterTriggerAuthentications**. If KEDA isn't installed, the page says so.

Each tab is the same table as a custom resource's own page (see [Resources](/docs/resources/)): the namespace filter, the [filter language](/docs/interface/#filtering-a-table), sorting, the **Columns** button, saved views, the copy button and row menu, and the drawer a row opens. It also has KEDA's own printer columns, such as Min, Max, Ready, Active and Triggers.

## ScaledObjects

| Column | Shows | Filter |
|---|---|---|
| Target | The workload it scales, such as `Deployment/api`, linked to it | `target:api` |
| Scales on | Its triggers in plain words, such as *CPU utilization* or *Kafka consumer lag*. A trigger type Kubebay doesn't know shows its raw name | `scales-on:kafka` |
| Paused | **No**, **Yes**, or **Yes, at 0 replicas** | `paused:yes` |
| HPA conflict | **Yes** when a HorizontalPodAutoscaler in its namespace also scales the same workload | `hpa-conflict:yes` |

When an HPA and a ScaledObject scale the same workload they fight over its replica count, and this is the most common way KEDA setups go wrong. A banner above the table counts them, and **Show them** filters the table to them. Scale-to-zero ScaledObjects are the ones whose Min is 0.

### Paused

KEDA pauses a ScaledObject through annotations, and the Paused column reads them:

- `autoscaling.keda.sh/paused-replicas: "0"` scales the workload to that count and holds it there (KEDA 2.7 and later). The column says **Yes, at 0 replicas**;
- `autoscaling.keda.sh/paused: "true"` holds the workload where it stands (KEDA 2.13 and later). The column says **Yes**;
- KEDA's own **Paused** condition says **Yes** too.

Remove the annotation, or set `autoscaling.keda.sh/paused` to `"false"`, to resume. ScaledJobs have the same Paused column.

## TriggerAuthentications

**In use** counts the ScaledObjects and ScaledJobs that reference each one: a TriggerAuthentication from its own namespace, a ClusterTriggerAuthentication from any. **No** is one left over from a ScaledObject that was removed. Filter them with `in-use:no`.

## A workload's Autoscaling tab

A Deployment's or StatefulSet's drawer has an **Autoscaling** tab. It shows every HPA, VPA and ScaledObject that targets the workload, with min, max and current replicas. A KEDA-managed workload is marked **Managed by KEDA**.

**New ScaledObject** opens a wizard:

1. Name it and set **Min replicas** and **Max replicas**.
2. Pick a **Trigger**:
   - **CPU utilization** or **Memory utilization**: set a target percentage;
   - **Cron schedule**: a start and end in cron syntax (such as `0 9 * * 1-5` and `0 18 * * 1-5`), a timezone, and the replicas to run in that window;
   - **Prometheus query**: the in-cluster server address, a PromQL query and a threshold. Kubebay suggests Prometheus Services it finds in the cluster.
3. Review the YAML, **Dry-run** it, then **Apply**.

A new ScaledObject is created paused, so it reports what it would do before it scales anything. The wizard adds `autoscaling.keda.sh/paused: "true"`, and `autoscaling.keda.sh/paused-replicas` set to the workload's current replicas, so it holds the workload where it is on any KEDA from 2.7. Remove both annotations when you're ready for it to scale.
