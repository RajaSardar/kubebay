---
title: Timeline
description: The cluster's events as they happen, with a warnings-only view and an hour of warning activity at a glance.
section: Tools
order: 6
appRoutes: ["/timeline"]
---

**Timeline** in the sidebar's Tools streams the cluster's events, newest first, in the namespaces you've picked.

- The badge at the top counts warnings.
- The strip below it shows warning activity over the last hour. It always covers every warning, whatever you filter below. It stops at an hour because the API server keeps events for about that long by default, so an older axis would be empty rather than calm.
- **Filter message / reason / object…** narrows the list, and **warnings only** hides normal events.

Each event names the object it's about. Click the object to open it, except for pods, which you open from [Pods](/docs/pods/).

## A workload's own timeline

A Deployment's, StatefulSet's or DaemonSet's drawer has a **Timeline** tab. It puts the workload's events, rollout revisions, condition changes and container terminations on one timeline, so you can see what changed right before something broke. See [Resource details](/docs/resource-details/#tabs).
