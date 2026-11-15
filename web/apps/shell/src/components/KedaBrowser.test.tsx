import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KedaBrowser } from "./KedaBrowser";

const obj = (name: string, ns?: string) => ({
  metadata: { name, ...(ns ? { namespace: ns } : {}) },
  spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, triggers: [] },
});

function renderBrowser() {
  return render(
    <MemoryRouter>
      <KedaBrowser
        scaledObjects={[obj("orders-so", "prod")]}
        scaledJobs={[obj("nightly-sj", "prod")]}
        triggerAuths={[obj("ta-one", "prod")]}
        clusterTriggerAuths={[obj("cta-aws")]}
        hpas={[]}
        orphanedTriggerAuths={[]}
      />
    </MemoryRouter>,
  );
}

describe("KedaBrowser", () => {
  it("opens on ScaledObjects", () => {
    renderBrowser();
    expect(screen.getByText("orders-so")).toBeTruthy();
    expect(screen.queryByText("nightly-sj")).toBeNull();
  });

  it("All view lists every KEDA kind", () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    for (const n of ["orders-so", "nightly-sj", "ta-one", "cta-aws"]) expect(screen.getByText(n)).toBeTruthy();
  });

  it("a kind button shows only that kind", () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("radio", { name: /^ScaledJobs/ }));
    expect(screen.getByText("nightly-sj")).toBeTruthy();
    expect(screen.queryByText("orders-so")).toBeNull();
  });

  it("search filters across kinds in the All view", () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    fireEvent.change(screen.getByPlaceholderText(/search keda/i), { target: { value: "cta" } });
    expect(screen.getByText("cta-aws")).toBeTruthy();
    expect(screen.queryByText("orders-so")).toBeNull();
  });

  it("search also filters the ScaledObjects view", () => {
    renderBrowser();
    fireEvent.change(screen.getByPlaceholderText(/search keda/i), { target: { value: "zzz" } });
    expect(screen.queryByText("orders-so")).toBeNull();
  });

  it("says when nothing matches", () => {
    renderBrowser();
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    fireEvent.change(screen.getByPlaceholderText(/search keda/i), { target: { value: "zzz" } });
    expect(screen.getByText(/no keda resources match/i)).toBeTruthy();
  });
});
