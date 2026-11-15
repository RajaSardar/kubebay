import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArgoDriftList } from "../ArgoDriftList";
import type { ArgoCDResource } from "../../lib/api";

function res(overrides: Partial<ArgoCDResource> = {}): ArgoCDResource {
  return { group: "apps", kind: "Deployment", namespace: "default", name: "app", status: "Synced", health: "Healthy", ...overrides };
}

function renderList(resources: ArgoCDResource[]) {
  return render(
    <MemoryRouter>
      <ArgoDriftList resources={resources} />
    </MemoryRouter>,
  );
}

describe("ArgoDriftList", () => {
  it("shows an all-synced state when nothing is drifted", () => {
    renderList([res(), res({ name: "b" })]);
    expect(screen.getByText(/all resources in sync/i)).toBeTruthy();
  });

  it("lists each resource with its kind, name, and status", () => {
    renderList([res({ status: "OutOfSync" })]);
    expect(screen.getByText("Deployment")).toBeTruthy();
    expect(screen.getByText("app")).toBeTruthy();
    expect(screen.getByText("OutOfSync")).toBeTruthy();
  });

  it("shows OutOfSync resources before Synced ones", () => {
    renderList([res({ name: "synced-one" }), res({ name: "drifted-one", status: "OutOfSync" })]);
    const names = screen.getAllByText(/-one$/).map((el) => el.textContent);
    expect(names).toEqual(["drifted-one", "synced-one"]);
  });

  it("links to the resource's own detail page when its Kind maps to a known slug", () => {
    renderList([res({ kind: "Deployment", name: "app", namespace: "default", status: "OutOfSync" })]);
    const link = screen.getByRole("link", { name: /app/ });
    expect(link.getAttribute("href")).toBe("/detail/deployments/default/app");
  });

  it("renders a plain (non-link) name when the Kind has no registered slug", () => {
    renderList([res({ kind: "SomeCustomResource", name: "widget", status: "OutOfSync" })]);
    expect(screen.queryByRole("link", { name: /widget/ })).toBeNull();
    expect(screen.getByText("widget")).toBeTruthy();
  });
});
