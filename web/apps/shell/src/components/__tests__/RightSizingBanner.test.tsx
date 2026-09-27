import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RightSizingBannerView } from "../RightSizingBanner";
import type { WorkloadRightSizingSummary } from "../../lib/rightsizing";

function summary(overrides: Partial<WorkloadRightSizingSummary> = {}): WorkloadRightSizingSummary {
  return {
    rows: [],
    wastedCpuMillis: 1200,
    wastedMemBytes: 512 * 1024 * 1024,
    ...overrides,
  };
}

function renderBanner(s: WorkloadRightSizingSummary | null) {
  return render(
    <MemoryRouter>
      <RightSizingBannerView summary={s} />
    </MemoryRouter>,
  );
}

describe("RightSizingBannerView", () => {
  it("renders nothing when there is no summary", () => {
    const { container } = renderBanner(null);
    expect(container.firstChild).toBeNull();
  });

  it("shows the total wasted cpu/mem and a link to the Right-sizing page", () => {
    renderBanner(summary());
    expect(screen.getByText(/1\.20/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /right-sizing/i });
    expect(link.getAttribute("href")).toBe("/right-sizing");
  });
});
