import { describe, expect, it } from "vitest";
import {
  appContainers,
  buildSidecarContainer,
  buildSidecarPatch,
  emptySidecarForm,
  nativeSidecarSupported,
  podTemplateSpec,
  podVolumes,
  presetForm,
  sidecarSlug,
  splitWords,
  validateSidecar,
  type SidecarForm,
} from "../addSidecar";

const deployment = (extra: Record<string, unknown> = {}) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop", annotations: { "argocd.argoproj.io/instance": "shop-app", "deployment.kubernetes.io/revision": "4" } },
  spec: {
    replicas: 2,
    template: {
      spec: {
        initContainers: [{ name: "migrate", image: "migrate:1" }],
        containers: [{ name: "app", image: "app:1", volumeMounts: [{ name: "config", mountPath: "/etc/app" }] }],
        volumes: [{ name: "config", configMap: { name: "app-config" } }],
        ...extra,
      },
    },
  },
});

const cronjob = () => ({
  apiVersion: "batch/v1",
  kind: "CronJob",
  metadata: { name: "nightly", namespace: "ops" },
  spec: { schedule: "0 1 * * *", jobTemplate: { spec: { template: { spec: { containers: [{ name: "job", image: "job:1" }] } } } } },
});

const form = (over: Partial<SidecarForm> = {}): SidecarForm => ({ ...emptySidecarForm(), name: "helper", image: "busybox:1.36", ...over });

describe("nativeSidecarSupported", () => {
  it.each([
    ["v1.29.0", true],
    ["v1.30.1+k3s1", true],
    ["v1.31.2-eks-7f9249a", true],
    ["v1.28.5-eks-5e0fdde", false],
    ["v1.27.0", false],
    ["1.29", true],
    ["", false],
    [undefined, false],
    ["garbage", false],
  ])("%s → %s", (v, want) => {
    expect(nativeSidecarSupported(v)).toBe(want);
  });
});

describe("sidecarSlug", () => {
  it("offers deployments, statefulsets, daemonsets and cronjobs, not jobs or nodes", () => {
    expect(["deployments", "statefulsets", "daemonsets", "cronjobs", "jobs", "nodes", "rollouts"].filter(sidecarSlug)).toEqual([
      "deployments",
      "statefulsets",
      "daemonsets",
      "cronjobs",
    ]);
  });
});

describe("splitWords", () => {
  it("splits on spaces and keeps quoted words together", () => {
    expect(splitWords(`sh -c 'tail -F /var/log/*.log'`)).toEqual(["sh", "-c", "tail -F /var/log/*.log"]);
    expect(splitWords(`MSG="hello world" A=1`)).toEqual(["MSG=hello world", "A=1"]);
    expect(splitWords("  ")).toEqual([]);
  });
  it("returns null on an unclosed quote", () => {
    expect(splitWords(`sh -c 'oops`)).toBeNull();
  });
});

describe("pod template helpers", () => {
  it("reads a workload's and a CronJob's pod template", () => {
    expect(appContainers(podTemplateSpec("deployments", deployment()))).toEqual(["app"]);
    expect(podVolumes(podTemplateSpec("deployments", deployment()))).toEqual(["config"]);
    expect(appContainers(podTemplateSpec("cronjobs", cronjob()))).toEqual(["job"]);
  });
});

describe("buildSidecarContainer", () => {
  it("builds the container spec from the form", () => {
    const c = buildSidecarContainer(
      form({
        command: "sh -c",
        args: `'echo hi'`,
        env: `LEVEL=debug MSG="a b"`,
        ports: "8080, 9090/UDP",
        cpuRequest: "10m",
        memoryRequest: "16Mi",
        memoryLimit: "64Mi",
        mounts: [{ volume: "config", mountPath: "/cfg" }],
      }),
    );
    expect(c).toEqual({
      name: "helper",
      image: "busybox:1.36",
      command: ["sh", "-c"],
      args: ["echo hi"],
      env: [
        { name: "LEVEL", value: "debug" },
        { name: "MSG", value: "a b" },
      ],
      ports: [
        { containerPort: 8080, protocol: "TCP" },
        { containerPort: 9090, protocol: "UDP" },
      ],
      resources: { requests: { cpu: "10m", memory: "16Mi" }, limits: { memory: "64Mi" } },
      volumeMounts: [{ name: "config", mountPath: "/cfg" }],
    });
  });

  it("leaves out empty fields and marks a native sidecar restartPolicy Always", () => {
    expect(buildSidecarContainer(form({ native: true }))).toEqual({ name: "helper", image: "busybox:1.36", restartPolicy: "Always" });
  });

  it("mounts a new emptyDir in the sidecar", () => {
    const c = buildSidecarContainer(form({ emptyDir: { name: "shared", mountPath: "/shared", shareWith: [] } }));
    expect(c.volumeMounts).toEqual([{ name: "shared", mountPath: "/shared" }]);
  });
});

describe("buildSidecarPatch", () => {
  it("appends a regular container through a strategic patch of the pod template only", () => {
    const p = buildSidecarPatch("deployments", deployment(), form());
    expect(p).toEqual({
      apiVersion: "apps/v1",
      kind: "Deployment",
      // Only the GitOps owner annotation travels, so the engine's audit entry can name the owner.
      metadata: { name: "web", namespace: "shop", annotations: { "argocd.argoproj.io/instance": "shop-app" } },
      spec: { template: { spec: { containers: [{ name: "helper", image: "busybox:1.36" }] } } },
    });
  });

  it("puts a native sidecar in initContainers", () => {
    const p = buildSidecarPatch("deployments", deployment(), form({ native: true })) as { spec: { template: { spec: Record<string, unknown> } } };
    expect(p.spec.template.spec).toEqual({ initContainers: [{ name: "helper", image: "busybox:1.36", restartPolicy: "Always" }] });
  });

  it("adds a shared emptyDir and mounts it in the chosen app containers", () => {
    const p = buildSidecarPatch(
      "deployments",
      deployment(),
      form({ emptyDir: { name: "shared-logs", mountPath: "/var/log/app", shareWith: ["app"] } }),
    ) as { spec: { template: { spec: Record<string, unknown> } } };
    expect(p.spec.template.spec).toEqual({
      containers: [
        { name: "helper", image: "busybox:1.36", volumeMounts: [{ name: "shared-logs", mountPath: "/var/log/app" }] },
        { name: "app", volumeMounts: [{ name: "shared-logs", mountPath: "/var/log/app" }] },
      ],
      volumes: [{ name: "shared-logs", emptyDir: {} }],
    });
  });

  it("patches a CronJob's job template", () => {
    const p = buildSidecarPatch("cronjobs", cronjob(), form({ native: true })) as Record<string, unknown>;
    expect(p).toEqual({
      apiVersion: "batch/v1",
      kind: "CronJob",
      metadata: { name: "nightly", namespace: "ops" },
      spec: { jobTemplate: { spec: { template: { spec: { initContainers: [{ name: "helper", image: "busybox:1.36", restartPolicy: "Always" }] } } } } },
    });
  });
});

describe("validateSidecar", () => {
  it("accepts a valid form", () => {
    expect(validateSidecar("deployments", deployment(), form(), true)).toEqual([]);
  });

  it("refuses a duplicate container name, including init containers", () => {
    expect(validateSidecar("deployments", deployment(), form({ name: "app" }), true)).toContain('A container named "app" already exists in this pod template.');
    expect(validateSidecar("deployments", deployment(), form({ name: "migrate" }), true)).toContain(
      'A container named "migrate" already exists in this pod template.',
    );
  });

  it("requires a DNS label name and an image", () => {
    const errs = validateSidecar("deployments", deployment(), form({ name: "Bad_Name", image: " " }), true);
    expect(errs).toContain("Name must be a DNS label: lower-case letters, digits and -, up to 63 characters.");
    expect(errs).toContain("Image is required.");
    expect(validateSidecar("deployments", deployment(), form({ name: "" }), true)).toContain("Name is required.");
  });

  it("checks env, ports, quantities and quotes", () => {
    const errs = validateSidecar(
      "deployments",
      deployment(),
      form({ env: "NOEQUALS", ports: "http, 70000", cpuRequest: "lots", command: "sh 'x" }),
      true,
    );
    expect(errs).toContain('Env "NOEQUALS" is not KEY=value.');
    expect(errs).toContain('Port "http" is not a number from 1 to 65535 with an optional /TCP, /UDP or /SCTP.');
    expect(errs).toContain('Port "70000" is not a number from 1 to 65535 with an optional /TCP, /UDP or /SCTP.');
    expect(errs).toContain('CPU request "lots" is not a quantity.');
    expect(errs).toContain("Command has an unclosed quote.");
  });

  it("checks mounts of existing volumes", () => {
    const errs = validateSidecar(
      "deployments",
      deployment(),
      form({
        mounts: [
          { volume: "nope", mountPath: "/a" },
          { volume: "config", mountPath: "relative" },
          { volume: "config", mountPath: "/a" },
        ],
      }),
      true,
    );
    expect(errs).toContain('Volume "nope" is not in this pod template.');
    expect(errs).toContain('Mount path "relative" must be absolute.');
    expect(errs).toContain('"/a" is mounted twice.');
  });

  it("checks a new emptyDir's name and where it is shared", () => {
    const errs = validateSidecar(
      "deployments",
      deployment(),
      form({ emptyDir: { name: "config", mountPath: "/etc/app", shareWith: ["app"] } }),
      true,
    );
    expect(errs).toContain('A volume named "config" already exists.');
    expect(errs).toContain('Container "app" already mounts something at /etc/app.');
  });

  it("refuses a native sidecar on a cluster older than 1.29", () => {
    expect(validateSidecar("deployments", deployment(), form({ native: true }), false)).toContain(
      "Native sidecars need Kubernetes 1.29 or newer.",
    );
  });

  it("refuses a regular container on a CronJob, which would keep every Job running", () => {
    expect(validateSidecar("cronjobs", cronjob(), form({ native: false }), true)).toContain(
      "A CronJob takes only a native sidecar: a regular container that never exits keeps every Job running.",
    );
  });
});

describe("presets", () => {
  it("log shipper tails a shared emptyDir that the app containers also mount", () => {
    const f = presetForm("log-shipper", ["app"], true);
    expect(f.image).toMatch(/^busybox/);
    expect(splitWords(f.command)).toEqual(["sh", "-c"]);
    expect(splitWords(f.args)?.[0]).toContain("tail");
    expect(splitWords(f.args)?.[0]).toContain("-F");
    expect(f.emptyDir).toEqual({ name: "shared-logs", mountPath: "/var/log/app", shareWith: ["app"] });
    expect(f.native).toBe(true);
    expect(validateSidecar("deployments", deployment(), f, true)).toEqual([]);
  });

  it("debug toolbox is netshoot sleeping, and a regular container when native is not supported", () => {
    const f = presetForm("debug-toolbox", ["app"], false);
    expect(f.image).toMatch(/^nicolaka\/netshoot/);
    expect(splitWords(f.command)).toEqual(["sleep", "infinity"]);
    expect(f.native).toBe(false);
  });

  it("Cloud SQL proxy listens on 5432", () => {
    const f = presetForm("cloud-sql-proxy", ["app"], true);
    expect(f.image).toContain("cloud-sql-proxy");
    expect(f.ports).toBe("5432");
  });

  it("custom is an empty form", () => {
    expect(presetForm("custom", ["app"], true)).toEqual({ ...emptySidecarForm(), native: true });
  });
});
