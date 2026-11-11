#!/usr/bin/env bash
# Local demo control plane (etcd + kube-apiserver + controller-manager), no kubelet.
set -euo pipefail
B="${KB_DEMO_BIN:?set KB_DEMO_BIN to a folder holding etcd, kube-apiserver and kube-controller-manager}"
D="${KB_DEMO_DIR:-/tmp/kubebay-demo}"
mkdir -p "$D"/etcd "$D"/pki
cd "$D"/pki
if [ ! -f sa.key ]; then
  openssl genrsa -out sa.key 2048 2>/dev/null
  openssl rsa -in sa.key -pubout -out sa.pub 2>/dev/null
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj "/CN=demo-ca" 2>/dev/null
  cat > san.cnf <<EOF
[req]
distinguished_name=dn
[dn]
[ext]
subjectAltName=IP:127.0.0.1,DNS:localhost,IP:10.96.0.1
EOF
  openssl req -newkey rsa:2048 -nodes -keyout apiserver.key -out apiserver.csr -subj "/CN=kube-apiserver" 2>/dev/null
  openssl x509 -req -in apiserver.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out apiserver.crt -days 30 -extfile san.cnf -extensions ext 2>/dev/null
  echo "demo-admin-token,admin,admin-uid,system:masters" > tokens.csv
fi
nohup "$B"/etcd --data-dir "$D"/etcd --listen-client-urls http://127.0.0.1:2379 \
  --advertise-client-urls http://127.0.0.1:2379 --listen-peer-urls http://127.0.0.1:2380 > "$D"/etcd.log 2>&1 &
sleep 2
nohup "$B"/kube-apiserver --etcd-servers=http://127.0.0.1:2379 --secure-port=6443 --bind-address=127.0.0.1 \
  --advertise-address=127.0.0.1 \
  --tls-cert-file="$D"/pki/apiserver.crt --tls-private-key-file="$D"/pki/apiserver.key \
  --client-ca-file="$D"/pki/ca.crt \
  --token-auth-file="$D"/pki/tokens.csv --authorization-mode=Node,RBAC \
  --service-account-issuer=https://kubernetes.default.svc --service-account-key-file="$D"/pki/sa.pub \
  --service-account-signing-key-file="$D"/pki/sa.key --service-cluster-ip-range=10.96.0.0/16 \
  --allow-privileged=true > "$D"/apiserver.log 2>&1 &
cat > "$D"/kubeconfig <<EOF
apiVersion: v1
kind: Config
clusters:
- name: prod-eu-west
  cluster: {server: "https://127.0.0.1:6443", certificate-authority: "$D/pki/ca.crt"}
users:
- name: admin
  user: {token: demo-admin-token}
contexts:
- name: prod-eu-west
  context: {cluster: prod-eu-west, user: admin}
current-context: prod-eu-west
EOF
for i in $(seq 1 60); do kubectl --kubeconfig "$D"/kubeconfig get --raw /readyz >/dev/null 2>&1 && break; sleep 1; done
nohup "$B"/kube-controller-manager --kubeconfig "$D"/kubeconfig --authentication-kubeconfig "$D"/kubeconfig \
  --authorization-kubeconfig "$D"/kubeconfig --service-account-private-key-file="$D"/pki/sa.key \
  --root-ca-file="$D"/pki/ca.crt --use-service-account-credentials=false --leader-elect=false \
  --controllers='*,-nodelifecycle,-nodeipam' --secure-port=10257 > "$D"/cm.log 2>&1 &
echo "up: KUBECONFIG=$D/kubeconfig"
