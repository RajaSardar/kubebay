import { describe, it, expect } from "vitest";
import { findSecretEnvExposures } from "../secretExposure";

function pod(ns: string, name: string, labels: Record<string, string>, containers: Record<string, unknown>[]) {
  return { metadata: { namespace: ns, name, labels }, spec: { containers } };
}

describe("findSecretEnvExposures", () => {
  it("flags a container with a secretKeyRef in env", () => {
    const pods = [
      pod("shop", "cart-1", { app: "cart" }, [
        { name: "app", env: [{ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: "db-creds", key: "password" } } }] },
      ]),
    ];
    const findings = findSecretEnvExposures(pods);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ namespace: "shop", appLabel: "cart" });
    expect(findings[0]?.secretNames).toEqual(["db-creds"]);
  });

  it("flags a container with an envFrom secretRef", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, [{ name: "app", envFrom: [{ secretRef: { name: "cart-env" } }] }])];
    const findings = findSecretEnvExposures(pods);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.secretNames).toEqual(["cart-env"]);
  });

  it("does not flag a pod that only mounts secrets as volumes", () => {
    const pods = [
      {
        metadata: { namespace: "shop", name: "cart-1", labels: { app: "cart" } },
        spec: {
          containers: [{ name: "app", env: [{ name: "PLAIN", value: "hello" }] }],
          volumes: [{ name: "creds", secret: { secretName: "db-creds" } }],
        },
      },
    ];
    expect(findSecretEnvExposures(pods)).toHaveLength(0);
  });

  it("does not flag a container with a plain env value (no secretKeyRef)", () => {
    const pods = [pod("shop", "cart-1", { app: "cart" }, [{ name: "app", env: [{ name: "MODE", value: "prod" }] }])];
    expect(findSecretEnvExposures(pods)).toHaveLength(0);
  });

  it("deduplicates the same secret referenced by multiple containers in one pod group", () => {
    const pods = [
      pod("shop", "cart-1", { app: "cart" }, [
        { name: "app", env: [{ name: "PW", valueFrom: { secretKeyRef: { name: "db-creds", key: "password" } } }] },
        { name: "sidecar", env: [{ name: "PW2", valueFrom: { secretKeyRef: { name: "db-creds", key: "password" } } }] },
      ]),
    ];
    const findings = findSecretEnvExposures(pods);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.secretNames).toEqual(["db-creds"]);
  });

  it("groups by namespace+app label, counting pods, not producing one finding per pod", () => {
    const container = [{ name: "app", envFrom: [{ secretRef: { name: "cart-env" } }] }];
    const pods = [pod("shop", "cart-1", { app: "cart" }, container), pod("shop", "cart-2", { app: "cart" }, container)];
    const findings = findSecretEnvExposures(pods);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ podCount: 2 });
  });

  it("also scans initContainers", () => {
    const pods = [
      { metadata: { namespace: "shop", name: "cart-1", labels: { app: "cart" } }, spec: { initContainers: [{ name: "migrate", envFrom: [{ secretRef: { name: "migration-secret" } }] }] } },
    ];
    const findings = findSecretEnvExposures(pods);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.secretNames).toEqual(["migration-secret"]);
  });

  it("returns an empty list for no pods", () => {
    expect(findSecretEnvExposures([])).toEqual([]);
  });
});
