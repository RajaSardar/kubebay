import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteResolutionList } from "../RouteResolutionList";
import type { RouteResolution } from "../../lib/routeResolution";

const ok: RouteResolution = {
  routeKind: "Ingress", namespace: "shop", name: "web", issues: [],
  paths: [{ host: "shop.example.com", path: "/", backend: "api:80", issues: [] }],
};
const broken: RouteResolution = {
  routeKind: "HTTPRoute", namespace: "shop", name: "checkout", issues: [{ kind: "gateway-missing", gateway: "infra/public" }],
  paths: [{ host: "pay.example.com", path: "/pay", backend: "pay:8080", issues: [{ kind: "port-missing", service: "pay", port: "8080" }] }],
};

describe("RouteResolutionList", () => {
  it("says so when the cluster has no routes", () => {
    render(<RouteResolutionList routes={[]} />);
    expect(screen.getByText(/no ingresses or httproutes/i)).toBeInTheDocument();
  });

  it("lists broken routes with each broken hop explained, and counts the healthy ones", () => {
    render(<RouteResolutionList routes={[ok, broken]} />);
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("Gateway infra/public not found")).toBeInTheDocument();
    expect(screen.getByText("Service pay has no port 8080")).toBeInTheDocument();
    expect(screen.getByText(/1 route resolves cleanly/i)).toBeInTheDocument();
    expect(screen.queryByText("web")).not.toBeInTheDocument();
  });

  it("gives an all-clear when every route resolves", () => {
    render(<RouteResolutionList routes={[ok]} />);
    expect(screen.getByText(/every route resolves to a ready backend/i)).toBeInTheDocument();
  });
});
