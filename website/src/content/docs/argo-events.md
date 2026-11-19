---
title: Argo Events
description: Argo Events EventSources, Sensors and EventBus, whether each is Ready, the events each declares and what each Sensor trigger creates.
section: Integrations
order: 21
appRoutes: ["/argo-events"]
---

**Argo Events** in the sidebar's Tools lists the cluster's Argo Events objects. If none of the `argoproj.io` kinds `eventsources`, `sensors` or `eventbus` exists on the cluster, the page says so. The page is read-only: it reads the objects through the Kubernetes API and changes nothing.

The namespace filter at the top of the app applies. A row of buttons picks the kind: **EventSources**, **Sensors** and **EventBus**, each with its count.

## State

Argo Events objects report several conditions rather than one Ready (for example Deployed, SourcesProvided, TriggersProvided, Configured). Kubebay shows:

- **Ready**, when every condition is True;
- **Not ready**, when any is False, with that condition's message beneath it;
- **Unknown**, when the object has no conditions yet or one is still Unknown.

Hover the pill to see each condition.

## EventSources

For each EventSource: its state, the EventBus it publishes to (`default` when it names none) and the events it declares, as `type: name`, such as `webhook: push` or `calendar: tick`. The event types come from the EventSource's spec, so a type Kubebay hasn't heard of is still listed.

## Sensors

For each Sensor: its state, its EventBus, what it **Listens to** as `eventSource / event`, and its **Triggers**. A trigger shows its name, its type (`argoWorkflow`, `k8s`, `http`, `awsLambda` and so on), its operation, and, when it creates a Kubernetes object, the kind of object:

- a trigger that creates a **Workflow** links to that Workflow when the Sensor names one. A Workflow created with `generateName` has no fixed name (shown as `ci-*`), so it links to the [Argo Workflows](/docs/argo-workflows/) page instead;
- other Kubernetes kinds are linked when Kubebay has a page for the kind and the Sensor names the object;
- a trigger whose manifest comes from a file, URL or ConfigMap shows no kind, because Kubebay doesn't fetch it;
- a trigger that isn't a Kubernetes object (an HTTP call, a Slack message) shows its type only.

## EventBus

The bus's state, its backend (`jetstream`, `nats`, `nats (external)` or `kafka`) and its replica count, when the spec sets one.
