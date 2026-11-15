import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PodEnvValue } from "./PodEnvValue";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, getObject: vi.fn() } };
});

const pod = {
  metadata: { name: "web-1", namespace: "prod" },
  spec: { nodeName: "node-a" },
  status: { podIP: "10.0.0.5" },
};

const container = { resources: { requests: { cpu: "500m" } } };

function renderValue(envVar: { name: string; value?: string; valueFrom?: Record<string, unknown> }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PodEnvValue cluster="kind-a" namespace="prod" pod={pod} container={container} envVar={envVar} />
    </QueryClientProvider>,
  );
}

describe("PodEnvValue", () => {
  beforeEach(() => {
    vi.mocked(api.getObject).mockReset();
  });

  it("renders a literal value as-is", () => {
    renderValue({ name: "MODE", value: "prod" });
    expect(screen.getByText("prod")).toBeTruthy();
  });

  it("resolves a fieldRef to the pod's live value", () => {
    renderValue({ name: "POD_IP", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } });
    expect(screen.getByText("10.0.0.5")).toBeTruthy();
  });

  it("resolves a resourceFieldRef against the container's resources", () => {
    renderValue({ name: "CPU_REQUEST", valueFrom: { resourceFieldRef: { resource: "requests.cpu" } } });
    expect(screen.getByText("500m")).toBeTruthy();
  });

  it("fetches and resolves a configMapKeyRef value", async () => {
    vi.mocked(api.getObject).mockResolvedValue({ data: { LOG_LEVEL: "debug" } });
    renderValue({ name: "LOG_LEVEL", valueFrom: { configMapKeyRef: { name: "app-config", key: "LOG_LEVEL" } } });
    await waitFor(() => expect(screen.getByText("debug")).toBeTruthy());
    expect(api.getObject).toHaveBeenCalledWith("kind-a", "v1/configmaps", "prod", "app-config");
  });

  it("falls back to a placeholder when the configMapKeyRef key is missing", async () => {
    vi.mocked(api.getObject).mockResolvedValue({ data: {} });
    renderValue({ name: "LOG_LEVEL", valueFrom: { configMapKeyRef: { name: "app-config", key: "LOG_LEVEL" } } });
    await waitFor(() => expect(screen.getByText(/configMapKeyRef\(app-config\)/)).toBeTruthy());
  });

  it("renders a SecretValueReveal control for a secretKeyRef", () => {
    renderValue({ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: "db-creds", key: "password" } } });
    expect(screen.getByText(/secret\(db-creds\)\[password\]/)).toBeTruthy();
  });

  it("renders a placeholder when fieldRef cannot be resolved", () => {
    renderValue({ name: "MYSTERY", valueFrom: { fieldRef: { fieldPath: "status.bogus" } } });
    expect(screen.getByText(/fieldRef\(status\.bogus\)/)).toBeTruthy();
  });
});
