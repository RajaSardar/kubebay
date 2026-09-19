/** YAML starter templates for the Create Resource panel — adapted from FreeLens. */

export interface ResourceTemplate {
  kind: string;
  apiVersion: string;
  yaml: string;
}

export const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    kind: "Deployment",
    apiVersion: "apps/v1",
    yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  namespace: default
  labels:
    app: nginx
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: web
        image: nginx:latest
        ports:
        - name: http
          containerPort: 80
          protocol: TCP
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
`,
  },
  {
    kind: "StatefulSet",
    apiVersion: "apps/v1",
    yaml: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
  namespace: default
spec:
  selector:
    matchLabels:
      app: nginx
  serviceName: nginx
  replicas: 1
  template:
    metadata:
      labels:
        app: nginx
    spec:
      terminationGracePeriodSeconds: 10
      containers:
      - name: nginx
        image: nginx:latest
        ports:
        - containerPort: 80
          name: web
`,
  },
  {
    kind: "DaemonSet",
    apiVersion: "apps/v1",
    yaml: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: kube-system
  labels:
    k8s-app: fluentd-logging
spec:
  selector:
    matchLabels:
      name: fluentd
  template:
    metadata:
      labels:
        name: fluentd
    spec:
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
      containers:
      - name: fluentd
        image: fluent/fluentd:latest
`,
  },
  {
    kind: "Job",
    apiVersion: "batch/v1",
    yaml: `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: default
spec:
  template:
    spec:
      containers:
      - name: worker
        image: busybox
        command: ["/bin/sh", "-c", "echo hello && sleep 5"]
      restartPolicy: Never
  backoffLimit: 3
`,
  },
  {
    kind: "CronJob",
    apiVersion: "batch/v1",
    yaml: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello
  namespace: default
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: hello
            image: busybox
            command:
            - /bin/sh
            - -c
            - date; echo Hello from the Kubernetes cluster
          restartPolicy: OnFailure
`,
  },
  {
    kind: "Service",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: default
spec:
  selector:
    app: my-app
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
  type: ClusterIP
`,
  },
  {
    kind: "Ingress",
    apiVersion: "networking.k8s.io/v1",
    yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: default
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - host: my-app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-service
            port:
              number: 80
`,
  },
  {
    kind: "ConfigMap",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: default
data:
  app.properties: |
    key=value
    another=setting
  LOG_LEVEL: info
`,
  },
  {
    kind: "Secret",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: default
type: Opaque
stringData:
  username: admin
  password: changeme
`,
  },
  {
    kind: "PersistentVolumeClaim",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: default
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`,
  },
  {
    kind: "ServiceAccount",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-service-account
  namespace: default
`,
  },
  {
    kind: "Namespace",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
`,
  },
  {
    kind: "Role",
    apiVersion: "rbac.authorization.k8s.io/v1",
    yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: default
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "watch", "list"]
`,
  },
  {
    kind: "ClusterRole",
    apiVersion: "rbac.authorization.k8s.io/v1",
    yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "watch", "list"]
`,
  },
  {
    kind: "RoleBinding",
    apiVersion: "rbac.authorization.k8s.io/v1",
    yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: default
subjects:
- kind: ServiceAccount
  name: my-service-account
  namespace: default
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
`,
  },
  {
    kind: "ClusterRoleBinding",
    apiVersion: "rbac.authorization.k8s.io/v1",
    yaml: `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: read-secrets-global
subjects:
- kind: ServiceAccount
  name: my-service-account
  namespace: default
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io
`,
  },
  {
    kind: "HorizontalPodAutoscaler",
    apiVersion: "autoscaling/v2",
    yaml: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-hpa
  namespace: default
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-deployment
  minReplicas: 1
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
`,
  },
  {
    kind: "Pod",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: Pod
metadata:
  name: static-web
  namespace: default
  labels:
    role: myrole
spec:
  containers:
  - name: web
    image: nginx
    ports:
    - name: web
      containerPort: 80
      protocol: TCP
`,
  },
  {
    kind: "ReplicaSet",
    apiVersion: "apps/v1",
    yaml: `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: frontend
  namespace: default
  labels:
    app: guestbook
    tier: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      tier: frontend
  template:
    metadata:
      labels:
        tier: frontend
    spec:
      containers:
      - name: app
        image: nginx:latest
`,
  },
  {
    kind: "ReplicationController",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: ReplicationController
metadata:
  name: nginx
  namespace: default
spec:
  replicas: 3
  selector:
    app: nginx
  template:
    metadata:
      name: nginx
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx
        ports:
        - containerPort: 80
`,
  },
  {
    kind: "PersistentVolume",
    apiVersion: "v1",
    yaml: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
  - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: standard
  hostPath:
    path: /mnt/data
`,
  },
  {
    kind: "NetworkPolicy",
    apiVersion: "networking.k8s.io/v1",
    yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-app-ingress
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          role: frontend
    ports:
    - protocol: TCP
      port: 8080
`,
  },
  {
    kind: "PriorityClass",
    apiVersion: "scheduling.k8s.io/v1",
    yaml: `apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
description: High priority workloads.
`,
  },
  {
    kind: "RuntimeClass",
    apiVersion: "node.k8s.io/v1",
    yaml: `apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
`,
  },
];
