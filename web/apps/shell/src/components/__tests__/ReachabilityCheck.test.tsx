import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReachabilityCheck } from "../ReachabilityCheck";

type Obj = Record<string, unknown>;
const pod = (name: string, ns: string, labels: Record<string, string>): Obj => ({
  metadata: { name, namespace: ns, labels },
  spec: { containers: [{ name: "c" }] },
  status: { podIP: "10.1.0.1" },
});
const pods = [pod("web-1", "shop", { app: "web" }), pod("api-1", "shop", { app: "api" })];
const namespaces = [{ metadata: { name: "shop" } }];
const denyAll = { metadata: { name: "deny-all", namespace: "shop" }, spec: { podSelector: {}, policyTypes: ["Ingress"] } };

function pick(src: string, dst: string) {
  fireEvent.change(screen.getByLabelText("Source pod"), { target: { value: src } });
  fireEvent.change(screen.getByLabelText("Destination pod"), { target: { value: dst } });
}

describe("ReachabilityCheck", () => {
  it("asks for two pods before giving a verdict", () => {
    render(<ReachabilityCheck pods={pods} policies={[]} namespaces={namespaces} />);
    expect(screen.getByText(/pick a source and a destination pod/i)).toBeInTheDocument();
  });

  it("says a connection is allowed when no policy isolates either pod", () => {
    render(<ReachabilityCheck pods={pods} policies={[]} namespaces={namespaces} />);
    pick("shop/web-1", "shop/api-1");
    expect(screen.getByText("Allowed")).toBeInTheDocument();
    expect(screen.getAllByText(/not isolated/i).length).toBe(2);
  });

  it("names the isolating policy when ingress blocks the connection", () => {
    render(<ReachabilityCheck pods={pods} policies={[denyAll]} namespaces={namespaces} />);
    pick("shop/web-1", "shop/api-1");
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText(/shop\/deny-all/)).toBeInTheDocument();
  });

  it("re-evaluates for a specific port", () => {
    const portOnly = { metadata: { name: "api-8080", namespace: "shop" }, spec: { podSelector: {}, ingress: [{ ports: [{ port: 8080 }] }] } };
    render(<ReachabilityCheck pods={pods} policies={[portOnly]} namespaces={namespaces} />);
    pick("shop/web-1", "shop/api-1");
    expect(screen.getByText(/only on TCP\/8080/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "9090" } });
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });
});
