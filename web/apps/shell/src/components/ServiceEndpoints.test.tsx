import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ServiceSummary } from "./ServiceSummary";

// Backlog 64: the Service drawer's Endpoints section.
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigateMock,
}));

const calls: { gvr: string; opts: Record<string, unknown> }[] = [];
let rows: Record<string, unknown>[] = [];
vi.mock("../lib/useResourceStream", () => ({
  useResourceStream: (_c: string, gvr: string, opts: Record<string, unknown>) => {
    calls.push({ gvr, opts });
    return { rows, synced: true, connected: true };
  },
}));

const svc = {
  metadata: { name: "web", namespace: "shop" },
  spec: { type: "NodePort", clusterIP: "10.1.1.1", selector: { app: "web" }, ports: [{ port: 80, nodePort: 30080, protocol: "TCP" }] },
};

function draw(obj: Record<string, unknown> = svc) {
  return render(
    <MemoryRouter>
      <ServiceSummary obj={obj} cluster="kind-test" />
    </MemoryRouter>,
  );
}

describe("Service drawer: Endpoints", () => {
  it("lists addresses with readiness, the target pod as a link, and the ports", () => {
    rows = [
      {
        metadata: { name: "web-x", namespace: "shop", labels: { "kubernetes.io/service-name": "web" } },
        endpoints: [
          { addresses: ["10.0.0.1"], conditions: { ready: true }, nodeName: "n1", targetRef: { kind: "Pod", name: "web-1", namespace: "shop" } },
          { addresses: ["10.0.0.2"], conditions: { ready: false }, targetRef: { kind: "Pod", name: "web-2", namespace: "shop" } },
        ],
        ports: [{ name: "http", port: 8080, protocol: "TCP" }],
      },
    ];
    draw();
    expect(screen.getByText("Endpoints (1 ready, 1 not ready)")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByText("http 8080/TCP")).toBeInTheDocument();
    fireEvent.click(screen.getByText("web-1"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/pods/shop/web-1");
    const call = calls.at(-1)!;
    expect(call.gvr).toBe("discovery.k8s.io/v1/endpointslices");
    expect(call.opts).toMatchObject({ ns: ["shop"], labelSelector: "kubernetes.io/service-name=web", mode: "full" });
  });

  it("says so when a selector Service has no endpoints", () => {
    rows = [];
    draw();
    expect(screen.getByText("Endpoints (0)")).toBeInTheDocument();
    expect(screen.getByText(/No endpoints/)).toBeInTheDocument();
  });

  it("is not shown for an ExternalName Service", () => {
    rows = [];
    draw({ metadata: { name: "ext", namespace: "shop" }, spec: { type: "ExternalName", externalName: "a.example.com" } });
    expect(screen.queryByText(/^Endpoints/)).toBeNull();
  });
});
