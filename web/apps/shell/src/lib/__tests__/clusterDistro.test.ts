import { describe, it, expect } from "vitest";
import { detectDistro } from "../clusterDistro";

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
