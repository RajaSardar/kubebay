---
title: KEDA
description: Every KEDA ScaledObject in plain words, HPAs that fight them, scale-to-zero workloads, unused TriggerAuthentications, and a wizard for new ScaledObjects.
section: Integrations
order: 6
appRoutes: ["/keda"]
---

**KEDA** in the sidebar's Tools lists the cluster's KEDA `ScaledObject` objects. If KEDA isn't installed, the page says so.

## ScaledObjects

Each one is explained in plain words, such as *scales 1→20 on cron Mon–Fri 09:00*, with its target workload linked. A trigger type Kubebay doesn't know is shown by its raw name rather than dropped.

Filter with the buttons above the list:

- **All**;
- **Conflicts**: ScaledObjects whose workload also has its own HorizontalPodAutoscaler. The two fight over the replica count, and this is the most common way KEDA setups go wrong;
- **scale-to-zero**: ScaledObjects with `minReplicaCount: 0`, whose workload can go idle between triggers.

## Orphaned TriggerAuthentications

`TriggerAuthentication` objects that no ScaledObject references, listed under **Orphaned trigger authentications**. They're usually left over from a ScaledObject that was removed.

## A workload's Autoscaling tab

A Deployment's or StatefulSet's drawer has an **Autoscaling** tab. It shows every HPA, VPA and ScaledObject that targets the workload, with min, max and current replicas. A KEDA-managed workload is marked **Managed by KEDA**.

**New ScaledObject** opens a wizard:

1. Name it and set **Min replicas** and **Max replicas**.
2. Pick a **Trigger**:
   - **CPU utilization** or **Memory utilization**: set a target percentage;
   - **Cron schedule**: a start and end in cron syntax (such as `0 9 * * 1-5` and `0 18 * * 1-5`), a timezone, and the replicas to run in that window;
   - **Prometheus query**: the in-cluster server address, a PromQL query and a threshold. Kubebay suggests Prometheus Services it finds in the cluster.
3. Review the YAML, **Dry-run** it, then **Apply**.
