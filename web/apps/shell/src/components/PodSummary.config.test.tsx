import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PodSummary } from "./PodSummary";

// Backlog 62: the pod drawer shows labels, env sources and the Secrets and
// ConfigMaps a pod uses, as references only.
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigateMock,
}));
vi.mock("../lib/useOwnerChain", () => ({ useOwnerChain: () => [] }));
vi.mock("./PodEnvValue", () => ({
  PodEnvValue: ({ envVar }: { envVar: { name: string } }) => <span data-testid={`env-${envVar.name}`}>resolved</span>,
}));
vi.mock("./PodContainerPortForward", () => ({ PodContainerPortForward: () => null }));

const env = Array.from({ length: 25 }, (_, i) => ({ name: `VAR_${i}`, value: String(i) }));
const pod = {
  metadata: { name: "web-1", namespace: "prod", uid: "u", labels: { app: "web", tier: "front" } },
  spec: {
    imagePullSecrets: [{ name: "regcred" }],
    containers: [
      {
        name: "app",
        image: "app:1",
        env: [...env, { name: "PASS", valueFrom: { secretKeyRef: { name: "db", key: "password" } } }],
        envFrom: [{ secretRef: { name: "creds" } }, { configMapRef: { name: "cfg" }, prefix: "CFG_" }],
      },
    ],
    volumes: [{ name: "tls", secret: { secretName: "tls-cert" } }],
  },
  status: { phase: "Running", containerStatuses: [{ name: "app", ready: true, state: { running: {} } }] },
};

function draw() {
  return render(
    <MemoryRouter>
      <PodSummary obj={pod} cluster="kind-a" />
    </MemoryRouter>,
  );
}

describe("PodSummary: labels, env and config references", () => {
  beforeEach(() => navigateMock.mockClear());

  it("shows the pod's labels", () => {
    draw();
    expect(screen.getByText("Labels (2)")).toBeInTheDocument();
    expect(screen.getByText("app=web")).toBeInTheDocument();
    expect(screen.getByText("tier=front")).toBeInTheDocument();
  });

  it("shows every environment variable, not only the first twenty", () => {
    draw();
    expect(screen.getByTestId("env-VAR_24")).toBeInTheDocument();
    expect(screen.getByTestId("env-PASS")).toBeInTheDocument();
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it("lists the envFrom sources as references with their prefix", () => {
    draw();
    expect(screen.getByText("Environment from (2)")).toBeInTheDocument();
    expect(screen.getByText("CFG_")).toBeInTheDocument();
  });

  it("lists the Secrets and ConfigMaps the pod uses, linking to them, never a value", () => {
    draw();
    expect(screen.getByText("Secrets (4)")).toBeInTheDocument();
    expect(screen.getByText("ConfigMaps (1)")).toBeInTheDocument();
    expect(screen.getByText(/env PASS \(app\)/)).toBeInTheDocument();
    expect(screen.getByText("regcred")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("tls-cert")[0]!);
    expect(navigateMock).toHaveBeenCalledWith("/detail/secrets/prod/tls-cert");
    expect(screen.queryByText(/hunter2/)).toBeNull();
  });

  it("omits the sections for a pod with no labels or references", () => {
    render(
      <MemoryRouter>
        <PodSummary obj={{ metadata: { name: "p", namespace: "n" }, spec: { containers: [{ name: "a" }] }, status: {} }} cluster="c" />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/^Labels/)).toBeNull();
    expect(screen.queryByText(/^Secrets/)).toBeNull();
  });
});
