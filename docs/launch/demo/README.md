# Demo cluster for launch media

Everything in [`../media/`](../media/) was captured from Kubebay v0.7.0 running against this demo cluster. **The cluster and its data are synthetic.** The names (`prod-eu-west`, `shop`, `payments`, `ghcr.io/acme/…`) are made up, and no real workload runs. Say so wherever the media is used ("demo cluster").

## Why it isn't kind

kind needs nested containers. Where those aren't available (as in the cloud sandbox the media was made in), this runs the real control plane directly instead:

- `etcd`, `kube-apiserver` and `kube-controller-manager`, the real binaries, so Deployments create real ReplicaSets and Pods, and RBAC, NetworkPolicy and Service objects are real API objects;
- `fakelet.py`, a stand-in kubelet that registers three Ready nodes, binds pods to them (all `storefront` replicas onto `worker-1`), reports them Running, keeps `ledger-worker` in CrashLoopBackOff, and posts a few Warning events.

Kubebay's analysis reads API objects, so its findings are the real thing.

## What `seed.yaml` plants, and the view that catches it

| Planted problem | Where Kubebay shows it |
|---|---|
| `payments/payments-api`: 1 replica, no PodDisruptionBudget | Overview → SPOF Radar ("No PDB", "Single backend") |
| `shop/storefront`: 3 replicas, all on one node | SPOF Radar ("Clustered") |
| `shop/storefront`: a LoadBalancer Service, and its ServiceAccount bound to `cluster-admin` | RBAC → Attack paths, Findings |
| `payments/ledger-worker`: crash-looping | Overview "Failing" banner, Needs attention, Timeline |
| `payments`: default-deny, plus an allow from `shop` | Network Policy → Connectivity matrix |

## Regenerate

You need the three control-plane binaries (from the `registry.k8s.io` images or a kind node image), Python 3, Node with Playwright, `ffmpeg`, and a Kubebay engine build.

```bash
export KB_DEMO_BIN=/path/to/k8s-binaries KB_DEMO_DIR=/tmp/kubebay-demo
bash docs/launch/demo/up.sh
python3 docs/launch/demo/fakelet.py &
kubectl --kubeconfig $KB_DEMO_DIR/kubeconfig apply -f docs/launch/demo/seed.yaml
```

Run the engine against **only** the demo kubeconfig, with a throwaway HOME, so it never reads your real `~/.kube/config`:

```bash
HOME=/tmp/kubebay-demo-home KUBECONFIG=$KB_DEMO_DIR/kubeconfig engine/bin/kubebay --addr 127.0.0.1:9898 &
export KB_TOKEN_FILE=/tmp/kubebay-demo-home/.config/kubebay/session-token
node docs/launch/demo/shoot.js docs/launch/media            # screenshots, 1440×900 at 2×
node docs/launch/demo/tour.js /tmp/kubebay-video            # ~28 s tour as .webm
```

Wait a minute after seeding before you shoot, so the pods have been bound and the events posted.

Turn the tour into the README GIF and MP4. The v0.7.0 media cuts about 2 s after the cluster list: in that build the Overview banner briefly read "Healthy · All 0 pods healthy" before the pods loaded. That's fixed after v0.7.0 (it now says "Checking"), so from the next release no cut is needed: the first command becomes `ffmpeg -i tour.webm -c:v libx264 -pix_fmt yuv420p -crf 24 kubebay-tour.mp4`. The v0.7.0 commands, for reference:

```bash
ffmpeg -i tour.webm -filter_complex "[0:v]trim=0:1.5,setpts=PTS-STARTPTS[a];[0:v]trim=start=3.8,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 24 kubebay-tour.mp4
ffmpeg -i kubebay-tour.mp4 -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" pal.png
ffmpeg -i kubebay-tour.mp4 -i pal.png -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" kubebay-tour.gif
```
