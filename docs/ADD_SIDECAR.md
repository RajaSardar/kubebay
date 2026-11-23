# Add sidecar (backlog 56)

## What it does

An **Add sidecar** button in the drawer of a Deployment, StatefulSet, DaemonSet
or CronJob opens a dialog that appends one container to the workload's pod
template. The user picks a preset or fills the form, previews the change as a
server dry-run diff, and applies it with a second, explicit click.

## What it does not do

- Never applies by itself: **Add sidecar** in the dialog is enabled only after
  **Preview** has dry-run exactly the patch that will be sent.
- No full replace. The change is a strategic merge patch through the existing
  `PUT /api/yaml` (`mode: "strategic"`, `action: "add-sidecar"`), so
  `containers`, `initContainers`, `volumes` and `volumeMounts` merge by their
  keys (`name`, `mountPath`) and nothing else in the object is sent.
- Not offered for Jobs: a Job's pod template is immutable once created. For a
  CronJob the change applies to the Jobs it creates next; running Jobs keep
  their pods.
- No removal or editing of an existing sidecar (use the YAML tab).

## Presets

| Preset | Image | Command | Volumes |
|---|---|---|---|
| Log shipper | `busybox:1.36` | `sh -c 'tail -n+1 -F /var/log/app/*.log'` | new emptyDir `shared-logs` at `/var/log/app`, also mounted in the app containers |
| Debug toolbox | `nicolaka/netshoot:latest` | `sleep infinity` | none |
| Cloud SQL proxy | `gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.1` | args `--port=5432 PROJECT:REGION:INSTANCE` | none, port 5432 |
| Custom | empty | empty | user's choice |

Every preset only fills the form; every field stays editable. Small default
requests (`10m` CPU, `16Mi` memory) are filled for the presets.

## Form

Name, image, command and args (split like a shell: quotes group words), env
(`KEY=value` words), ports (`8080, 9090/UDP`), CPU and memory requests and
limits, mounts of existing pod volumes (pick a volume, give a path), and a new
shared emptyDir (name, path, and which existing containers also mount it).

## Native sidecar

On Kubernetes 1.29 or newer (the cluster's `version` from the clusters list)
the dialog offers **Native sidecar**: the container goes in `initContainers`
with `restartPolicy: Always`, starts before the app containers, stays up as
long as the pod and does not keep a Job from completing. **Regular container**
appends to `containers`. On older clusters, or when the version is unknown,
only a regular container is offered and the dialog says why. For a CronJob a
regular container that never exits keeps each Job running for ever, so a
CronJob takes only a native sidecar, and on a cluster older than 1.29 the
dialog refuses to apply to one.

## Checks (pure, in `lib/addSidecar.ts`)

- Name is a DNS-1123 label and not already a container, init container or
  ephemeral container name in the template: duplicates are refused (a
  strategic patch would otherwise merge into the existing container).
- Image is required. Env words must be `KEY=value`. Ports are 1–65535 with an
  optional `/TCP`, `/UDP` or `/SCTP`.
- Mounts name an existing pod volume and an absolute path, once each.
- A new emptyDir's name must not collide with an existing volume, and its path
  must not already be mounted in a container it is shared with.

## Safety

- The same GitOps warning as Restart when Argo CD or Flux owns the workload
  (the change will be reverted on the next sync). The patch's metadata carries
  the owner annotation so the engine's audit entry records `owner=`.
- A warning that a pod-template change triggers a rollout restart, and the
  existing **What this affects** preview with the `restart` action.
- The production confirmation (`ProdApplyModal`) before the real apply.
- Policy rejections show as the usual card.
- Audited by the existing apply path: user, GVR, `action=add-sidecar`, patched
  field paths, dry-run flag. No engine change.

## Done when

Unit tests cover the patch builder, validation, presets and version check;
component tests cover the dialog (preview before apply, duplicate name,
native choice by version, GitOps warning, production confirmation, rollout
warning); the user manual and changelog describe it.
