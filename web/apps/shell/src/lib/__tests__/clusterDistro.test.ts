import { describe, it, expect } from "vitest";
import { detectDistro, providerBadge, clusterDisplayName } from "../clusterDistro";

describe("detectDistro", () => {
  it("detects EKS from ARN", () => {
    expect(detectDistro("arn:aws:eks:ap-south-1:294202164463:cluster/prod")).toBe("eks");
  });

  it("detects kind from prefix", () => {
    expect(detectDistro("kind-kb-ci")).toBe("kind");
    expect(detectDistro("kind-kubebay-dev")).toBe("kind");
  });

  it("detects orbstack", () => {
    expect(detectDistro("orbstack")).toBe("orbstack");
  });

  it("detects GKE from prefix", () => {
    expect(detectDistro("gke_my-project_us-central1_my-cluster")).toBe("gke");
  });

  it("detects k3d", () => {
    expect(detectDistro("k3d-local")).toBe("k3d");
  });

  it("detects minikube", () => {
    expect(detectDistro("minikube")).toBe("minikube");
  });

  it("detects docker-desktop", () => {
    expect(detectDistro("docker-desktop")).toBe("docker");
  });

  it("returns empty string for unknown", () => {
    expect(detectDistro("my-custom-cluster")).toBe("");
  });
});

describe("clusterDisplayName", () => {
  // Real-world: id = sanitized (colons/slashes → dashes), context = original ARN
  it("extracts short name from EKS context ARN", () => {
    expect(clusterDisplayName(
      "arn-aws-eks-ap-south-1-294202164463-cluster-prod-us-east-1",
      "arn:aws:eks:ap-south-1:294202164463:cluster/prod-us-east-1",
      undefined
    )).toBe("prod-us-east-1");
  });

  it("extracts last segment from GKE context", () => {
    expect(clusterDisplayName(
      "gke_my-project_us-central1_my-cluster",
      "gke_my-project_us-central1_my-cluster",
      undefined
    )).toBe("my-cluster");
  });

  it("returns alias when set, ignoring id/context patterns", () => {
    expect(clusterDisplayName(
      "arn-aws-eks-ap-south-1-123-cluster-prod",
      "arn:aws:eks:ap-south-1:123:cluster/prod",
      "my-alias"
    )).toBe("my-alias");
  });

  it("falls back to context when no known pattern", () => {
    expect(clusterDisplayName("some-cluster-id", "my-context", undefined))
      .toBe("my-context");
  });

  it("falls back to id when context is empty", () => {
    expect(clusterDisplayName("bare-id", "", undefined)).toBe("bare-id");
  });
});

describe("providerBadge", () => {
  it("returns AWS EKS label for EKS ARN", () => {
    const b = providerBadge("arn:aws:eks:ap-south-1:123:cluster/prod");
    expect(b.label).toBe("AWS EKS");
    expect(b.cls).toBe("badge-eks");
  });

  it("returns GKE label for GKE context", () => {
    const b = providerBadge("gke_project_us-central1_cluster");
    expect(b.label).toBe("GKE");
    expect(b.cls).toBe("badge-gke");
  });

  it("returns kind label", () => {
    const b = providerBadge("kind-kb-ci");
    expect(b.label).toBe("kind");
    expect(b.cls).toBe("badge-kind");
  });

  it("returns OrbStack label", () => {
    const b = providerBadge("orbstack");
    expect(b.label).toBe("OrbStack");
    expect(b.cls).toBe("badge-orbstack");
  });

  it("returns AKS label for aks- prefixed context", () => {
    const b = providerBadge("aks-my-cluster");
    expect(b.label).toBe("AKS");
    expect(b.cls).toBe("badge-aks");
  });

  it("returns dash for fully unknown cluster", () => {
    const b = providerBadge("my-custom-cluster");
    expect(b.label).toBe("–");
    expect(b.cls).toBe("badge-default");
  });
});
