# Golden-path E2E

KB-11. One Playwright test, `e2e/tests/golden-path.spec.ts`, walks the path every
Kubebay user walks, in Chromium, against the engine-served web build and a real
kind cluster:

1. Paste the session token and open the cluster from the cluster list.
2. Open Pods and the fixture pod.
3. **Logs** stream: a later line arrives while the tab is open.
4. **Terminal**: `echo kb-$((6*7))` comes back as `kb-42` from a shell in the pod.
5. **Port-forward**: the pod's Summary tab forwards its port, and the page it
   opens serves the pod's `index.html`. The forward is then stopped.
6. **YAML**: add a label, Dry-run, see the server's preview as a diff, Apply.
7. `kubectl` confirms the cluster stored the label.

The test also fails on any uncaught error in the page.

The pod it drives is `e2e/fixtures/golden-path.yaml`. It's a busybox pod, pinned
by digest, that logs `tick N` every second and serves a page on 8080.

## In CI

The `e2e (kind)` job in `.github/workflows/ci.yml` runs on every pull request
and on main. It:

1. Creates a kind cluster (Kubernetes 1.34) and the fixture pod.
2. Builds the engine with the web app embedded (`make web-install build`).
3. Starts the engine with its own kubeconfig and home directory.
4. Runs the test.

On failure it uploads `e2e-report`, which holds the Playwright HTML report, a
trace of the failed run (`npx playwright show-trace`) and the engine log.

Making the check required in branch protection is a repository setting; an
admin has to add `e2e (kind)`.

## DRA: `e2e dra (kind, Kubernetes 1.37)`

KB-12's acceptance test, `e2e/tests/dra.spec.ts`, runs in its own job. The job
creates a kind cluster with the [DRA example driver](https://github.com/kubernetes-sigs/dra-example-driver)'s
own cluster config from its v0.5.0 tag (Kubernetes 1.37, its feature gates and CDI). It then:

1. Installs the driver's chart from that tag.
2. Creates `e2e/fixtures/dra-claim.yaml`, a ResourceClaim for `gpu.example.com` and a pod using it.
3. Waits for the pod to be Ready, which means the claim is allocated.

The test checks what the tables show:
- **DeviceClasses:** `gpu.example.com`, with the driver its selector pins.
- **ResourceSlices:** the worker's pool of 8 GPUs.
- **ResourceClaims:** the claim allocated to a GPU on the worker and reserved for the pod.
- **Pod drawer:** "Resource claims (1)", whose link opens the claim. The claim's Summary shows the GPU it was given and links the pod it's reserved for.

## Running it locally

Use a dedicated kind cluster, never your default kubeconfig:

```sh
kind create cluster --name kubebay-e2e --kubeconfig /tmp/kubebay-e2e.kubeconfig
export KUBECONFIG=/tmp/kubebay-e2e.kubeconfig
kubectl create -f e2e/fixtures/golden-path.yaml
kubectl -n kubebay-e2e wait --for=condition=Ready pod/e2e-logger --timeout=180s

make build
KUBEBAY_TOKEN=e2e-token engine/bin/kubebay --no-open --kubeconfig "$KUBECONFIG" &

cd e2e
npm ci
npx playwright install chromium
KUBEBAY_TOKEN=e2e-token npx playwright test
```

The test adds an `e2e-edited` label to the pod. Delete the pod and create it
again before the next run:

```sh
kubectl -n kubebay-e2e delete pod e2e-logger
kubectl create -f e2e/fixtures/golden-path.yaml
```

Environment variables:
- `KUBEBAY_URL`: where the engine is. The default is `http://127.0.0.1:9898`.
- `KUBEBAY_TOKEN`: the engine's session token.
- `KUBEBAY_E2E_CONTEXT`: the cluster's kubeconfig context. The default is
  `kind-kubebay-e2e`.

## Flake budget

The test has no retries. A retry would hide exactly the flakiness this job is
meant to catch.

The budget is at most **one red run in 50 on main** that isn't a real bug. The
job's summary records each run's result and duration.

When a red run turns out not to be a bug:
1. Open an issue labelled `e2e-flake` with the trace from the run's `e2e-report`.
2. Fix it there, by making the test wait on something the user would see or
   fixing the race in the app. Never add a retry or a fixed sleep.

Over budget, flakes come first: fix them before the test grows a step.
