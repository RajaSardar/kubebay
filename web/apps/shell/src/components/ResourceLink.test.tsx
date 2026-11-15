import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResourceLink } from "./ResourceLink";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

describe("ResourceLink", () => {
  it("renders its children", () => {
    render(
      <MemoryRouter>
        <ResourceLink kind="nodes" name="node-a" />
      </MemoryRouter>,
    );
    expect(screen.getByText("node-a")).toBeTruthy();
  });

  it("navigates to the resource's detail page on click, namespaced", () => {
    render(
      <MemoryRouter>
        <ResourceLink kind="configmaps" ns="prod" name="app-config" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("app-config"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/configmaps/prod/app-config");
  });

  it("uses '_' for the namespace segment when the kind is cluster-scoped", () => {
    render(
      <MemoryRouter>
        <ResourceLink kind="nodes" name="node-a" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("node-a"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/nodes/_/node-a");
  });

  it("stops the click from bubbling to a parent handler", () => {
    const parentClick = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={parentClick}>
          <ResourceLink kind="nodes" name="node-a" />
        </div>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("node-a"));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("renders custom children instead of the bare name when provided", () => {
    render(
      <MemoryRouter>
        <ResourceLink kind="nodes" name="node-a">
          <span className="mono">node-a (custom)</span>
        </ResourceLink>
      </MemoryRouter>,
    );
    expect(screen.getByText("node-a (custom)")).toBeTruthy();
  });

  it("renders nothing when name is empty", () => {
    const { container } = render(
      <MemoryRouter>
        <ResourceLink kind="nodes" name="" />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });
});
