import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PodName } from "./PodName";

// Backlog 61: the generated end of a pod name is set apart, the whole name stays text.
describe("PodName", () => {
  it("shows the full name and marks the generated suffix", () => {
    const { container } = render(<PodName name="web-7d9f8c6b5d-x2k4q" />);
    expect(container.textContent).toBe("web-7d9f8c6b5d-x2k4q");
    expect(container.querySelector(".pod-suffix")?.textContent).toBe("-7d9f8c6b5d-x2k4q");
  });

  it("marks nothing in a name with no generated end", () => {
    const { container } = render(<PodName name="etcd" />);
    expect(container.textContent).toBe("etcd");
    expect(container.querySelector(".pod-suffix")).toBeNull();
  });
});
