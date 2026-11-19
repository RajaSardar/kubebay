# Owner column (backlog 54)

Where an Owner column (the object's controller from `metadata.ownerReferences`, `controller: true`) earns its place. It costs nothing where the object is already on screen, since ownerReferences travel with the metadata.

| List | Decision | Why |
|---|---|---|
| Pods | Default visible | The question "what runs this pod" is asked constantly. Shows the top-most controller where cheap: a pod of a ReplicaSet reads through to its Deployment (or Argo Rollout) using a metadata-only ReplicaSets stream; otherwise the direct owner (StatefulSet, DaemonSet, Job, Node for a static pod). Bare pod: —. |
| ReplicaSets | Default visible | Direct owner is the Deployment or Rollout; bare shows —. |
| Jobs | Available, hidden | Direct owner is the CronJob. |
| Every other generic kind (Deployments, Services, Endpoints/EndpointSlices, PVCs, ConfigMaps, CRDs...) | Available, hidden | One generic column, no extra stream. Helps for operator-created objects (an EndpointSlice owned by its Service, a Secret owned by a Certificate). |
| Events | Not added | Already has an **Object** column (the involved object); events have no ownerReferences. |
| Endpoints | Not added as a separate column | The Endpoints object is tied to its Service by name, not ownerReferences (EndpointSlices do carry one and get the generic column). |
| PVC "used by" | Not added | Needs a scan of every pod's volumes, not ownerReferences; a different feature. |
| Helm release, GitOps app | Not involved | Different relations: **Managed by** (GitOps) already exists, and Helm is shown in the drawer. |

Naming: the column header is **Owner**, its id and filter key are `Controller` and `controller` because the generic tables already use the id `Owner` and the filter key `owner` for the GitOps "Managed by" column (saved sorts depend on that id).

Compatibility: column layouts and saved views store `order` and `hidden` ids. A column that is not in a saved `order` now follows its own default (`defaultHidden`), so new hidden-by-default columns do not appear in old layouts, and new visible ones do.

Cost: Pods adds one metadata-mode ReplicaSets stream (same namespace scope as the pods).
