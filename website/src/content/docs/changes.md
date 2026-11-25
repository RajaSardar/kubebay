---
title: Changes
description: A local record of what changed in a cluster and which field manager changed it, with the periods nothing was recording shown honestly.
section: Tools
order: 7
appRoutes: ["/changes"]
---

**Changes** in the sidebar's Tools lists the object changes and Kubernetes events Kubebay saw in the cluster you picked, newest first. Each row has the **Time**, **Kind**, **Namespace**, **Name**, **What changed**, and the **Field manager** that made the change, such as `kubectl-client-side-apply`, `argocd-controller` or `kube-controller-manager`. Click a row to open the object (for an event, the object it is about; a deleted object has nothing to open).

It is a record kept on your computer. It is not a view of the cluster's own history, and it only holds what Kubebay saw.

## What is recorded

Kubebay watches the kinds your open pages show. For each one it keeps, per change:

- the object's kind, namespace, name and UID, and whether it was added, updated or deleted;
- the **paths** that changed (`spec.replicas`, `metadata.labels.app`), never their values. Label and annotation keys are named; their values are not kept;
- the field manager and time Kubernetes recorded for the write, from the object's `managedFields`. Kubebay does not keep the field sets inside `managedFields`, so the manager is the one that wrote most recently, and a change seen after a gap (below) is not attributed to anyone;
- for an event: its type, reason, the object it is about, and its message, with credentials masked and cut at 512 characters.

It never records a Secret, of any kind, or any value. It also skips objects that change every few seconds without meaning anything: Leases, Endpoints, EndpointSlices, and updates that only move a heartbeat, a resourceVersion or a generation. Several updates to one object within 30 seconds become one row marked "N updates merged", with every path that changed.

## Not recorded

Kubebay starts no watches of its own for this, so it records a kind only while a page that shows it is open, with the app running. The **Recording coverage by kind** bars above the list show, for each kind, a shaded stretch wherever nothing was recording it: the app was closed, no page had that kind open, the computer was asleep or the app was paused, the cluster refused access, or the oldest rows were removed to keep the file under its size limit. A gap is never filled in by guessing, and a quiet row of bars does not mean nothing happened, only that Kubebay was not looking.

Two limits to know:

- A watch that reconnects by itself inside a running page is not marked. After one, a change can arrive late or as one row that merges several; those rows say **during a gap** and name no manager.
- Kinds watched through a label selector, and kinds Kubebay watches for names only (it strips their `spec`), are recorded with the limits they have: a selected watch is skipped, since it sees part of the kind, and a names-only watch compares labels, annotation keys, finalizers and owners only, shown as "metadata only".

If changes arrive faster than they can be written, the extra are dropped and counted: the page says "N changes not recorded".

## Filters

Pick a **time range** (an hour to 30 days), a **Kind**, a **Namespace** or a **Field manager**. The lists offer what has been recorded. **Older** and **Newer** page through the results, 100 at a time.

## Keeping it

Under [Settings](/docs/settings/#change-timeline), **Change timeline** sets how long to keep changes: **Off**, 1, 3, 7 (the default), 14 or 30 days. Older rows are removed automatically, and the file is capped at 100 MB, the oldest going first. **Clear** deletes everything. Choosing **Off** deletes the file, not just stops writing to it.

The file is `timeline/timeline.db` in Kubebay's folder in your user config directory, readable only by you. It is not encrypted. It holds names and namespaces of objects you looked at, so treat it like the rest of that folder. If the file ever cannot be read, Kubebay sets it aside as `timeline.db.corrupt-<time>`, starts a new one and says so at the top of the page.

## When it is off

The timeline is a per-user file, so it is not kept when the engine runs in a cluster, or when OIDC or an auth proxy is configured: one person's record cannot be served to others, and what it saw was seen with one person's access. The page and the Settings card then show the reason, and nobody can turn it on or clear it.

Changing the retention and clearing the record are written to the [Audit Log](/docs/audit-log/) (`timeline-retention`, `timeline-clear`).

## Not run against a live cluster

The recording, filters and gaps were tested against fake API servers, a temporary database and a mock page, not against a real cluster, and not in the packaged desktop app.
