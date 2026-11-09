"""A stand-in kubelet for a demo cluster: registers nodes, binds pods, reports status."""
import json, os, ssl, time, urllib.request, datetime, sys

API = "https://127.0.0.1:6443"
TOKEN = "demo-admin-token"
CTX = ssl.create_default_context(cafile=os.path.join(os.environ.get("KB_DEMO_DIR", "/tmp/kubebay-demo"), "pki", "ca.crt"))
CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT
NODES = ["worker-1", "worker-2", "worker-3"]


def req(method, path, body=None, ctype="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method,
                               headers={"Authorization": "Bearer " + TOKEN, "Content-Type": ctype})
    try:
        with urllib.request.urlopen(r, context=CTX) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code not in (404, 409):
            print(method, path, e.code, e.read()[:300], file=sys.stderr)
        return None


def now(offset=0):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=offset)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_nodes():
    for i, n in enumerate(NODES):
        req("POST", "/api/v1/nodes", {"apiVersion": "v1", "kind": "Node", "metadata": {
            "name": n, "labels": {"kubernetes.io/hostname": n, "kubernetes.io/os": "linux",
                                  "topology.kubernetes.io/zone": f"eu-west-1{'abc'[i]}",
                                  "node.kubernetes.io/instance-type": "m6i.xlarge"}}})
        cond = [{"type": "Ready", "status": "True", "reason": "KubeletReady", "message": "kubelet is posting ready status",
                 "lastHeartbeatTime": now(), "lastTransitionTime": now(86400 * 6)},
                {"type": "MemoryPressure", "status": "False", "reason": "KubeletHasSufficientMemory",
                 "lastHeartbeatTime": now(), "lastTransitionTime": now(86400 * 6)},
                {"type": "DiskPressure", "status": "False", "reason": "KubeletHasNoDiskPressure",
                 "lastHeartbeatTime": now(), "lastTransitionTime": now(86400 * 6)}]
        cap = {"cpu": "4", "memory": "16Gi", "pods": "58", "ephemeral-storage": "100Gi"}
        req("PATCH", f"/api/v1/nodes/{n}/status", {"status": {
            "conditions": cond, "capacity": cap,
            "allocatable": {"cpu": "3920m", "memory": "15Gi", "pods": "58", "ephemeral-storage": "95Gi"},
            "addresses": [{"type": "InternalIP", "address": f"10.0.{i+1}.17"}, {"type": "Hostname", "address": n}],
            "nodeInfo": {"kubeletVersion": "v1.33.1", "kubeProxyVersion": "v1.33.1", "osImage": "Bottlerocket OS 1.40.0",
                         "containerRuntimeVersion": "containerd://2.0.5", "kernelVersion": "6.1.141",
                         "operatingSystem": "linux", "architecture": "amd64", "machineID": "", "systemUUID": "",
                         "bootID": ""}}}, "application/merge-patch+json")


rr = 0


def sync_pods():
    global rr
    pods = req("GET", "/api/v1/pods") or {"items": []}
    for p in pods["items"]:
        md, spec = p["metadata"], p["spec"]
        ns, name = md["namespace"], md["name"]
        node = spec.get("nodeName")
        if not node:
            labels = md.get("labels", {})
            try:  # DaemonSet pods name their node in a matchFields term
                node = spec["affinity"]["nodeAffinity"]["requiredDuringSchedulingIgnoredDuringExecution"][
                    "nodeSelectorTerms"][0]["matchFields"][0]["values"][0]
            except (KeyError, IndexError, TypeError):
                node = None
            if node:
                pass
            elif "demo/pin" in labels:
                node = labels["demo/pin"]
            else:
                node = NODES[rr % 3]; rr += 1
            req("POST", f"/api/v1/namespaces/{ns}/pods/{name}/binding",
                {"apiVersion": "v1", "kind": "Binding", "metadata": {"name": name},
                 "target": {"apiVersion": "v1", "kind": "Node", "name": node}})
        if p.get("status", {}).get("phase") == "Running" and md.get("labels", {}).get("demo/crash") != "true":
            continue
        crash = md.get("labels", {}).get("demo/crash") == "true"
        started = md.get("creationTimestamp", now())
        cs = []
        for c in spec["containers"]:
            if crash:
                cs.append({"name": c["name"], "image": c["image"], "imageID": "", "ready": False, "restartCount": 14,
                           "started": False,
                           "state": {"waiting": {"reason": "CrashLoopBackOff",
                                                 "message": "back-off 5m0s restarting failed container"}},
                           "lastState": {"terminated": {"exitCode": 1, "reason": "Error", "startedAt": now(400),
                                                        "finishedAt": now(390)}}})
            else:
                cs.append({"name": c["name"], "image": c["image"], "imageID": "", "ready": True, "restartCount": 0,
                           "started": True, "state": {"running": {"startedAt": started}}})
        ready = "False" if crash else "True"
        req("PATCH", f"/api/v1/namespaces/{ns}/pods/{name}/status", {"status": {
            "phase": "Running", "hostIP": "10.0.1.17", "podIP": f"10.244.{rr % 3}.{10 + rr % 200}",
            "startTime": started,
            "conditions": [{"type": "PodScheduled", "status": "True", "lastTransitionTime": started},
                           {"type": "Initialized", "status": "True", "lastTransitionTime": started},
                           {"type": "ContainersReady", "status": ready, "lastTransitionTime": started},
                           {"type": "Ready", "status": ready, "lastTransitionTime": started}],
            "containerStatuses": cs}}, "application/merge-patch+json")
        rr += 1


def events():
    for i, (ns, kind, name, reason, msg) in enumerate([
        ("payments", "Pod", "ledger-worker", "BackOff", "Back-off restarting failed container worker in pod ledger-worker"),
        ("shop", "Service", "storefront", "EnsuringLoadBalancer", "Ensuring load balancer"),
        ("payments", "Pod", "ledger-worker", "Unhealthy", "Liveness probe failed: HTTP probe failed with statuscode: 500"),
    ]):
        req("POST", f"/api/v1/namespaces/{ns}/events", {
            "apiVersion": "v1", "kind": "Event", "metadata": {"name": f"demo-{i}-{int(time.time())}"},
            "involvedObject": {"kind": kind, "namespace": ns, "name": name},
            "reason": reason, "message": msg, "type": "Warning" if reason != "EnsuringLoadBalancer" else "Normal",
            "firstTimestamp": now(600), "lastTimestamp": now(), "count": 9, "source": {"component": "kubelet"}})


ensure_nodes()
tick = 0
while True:
    sync_pods()
    if tick % 6 == 0:
        ensure_nodes()
    if tick % 30 == 0:
        events()
    tick += 1
    time.sleep(5)
