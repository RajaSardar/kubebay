import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ServiceMismatchList } from "./ServiceMismatchList";
import type { ServiceMismatchFinding } from "../lib/serviceSelectorMismatch";

function renderList(findings: ServiceMismatchFinding[]) {
  return render(
    <MemoryRouter>
      <ServiceMismatchList findings={findings} />
    </MemoryRouter>,
  );
}

const finding = (over: Partial<ServiceMismatchFinding> = {}): ServiceMismatchFinding => ({
  namespace: "shop",
  serviceName: "cart",
  reason: "no-matching-pods",
  ...over,
});

describe("ServiceMismatchList", () => {
  it("shows an all-healthy empty state when there are no findings", () => {
    renderList([]);
    expect(screen.getByText(/every service has healthy endpoints/i)).toBeTruthy();
  });

  it("lists a Service with no matching pods", () => {
    renderList([finding()]);
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("cart")).toBeTruthy();
    expect(screen.getByText(/selector matches no pods/i)).toBeTruthy();
  });

  it("lists a Service with zero ready endpoints distinctly from a selector mismatch", () => {
    renderList([finding({ reason: "zero-ready-endpoints" })]);
    expect(screen.getByText(/zero ready endpoints/i)).toBeTruthy();
  });
});
