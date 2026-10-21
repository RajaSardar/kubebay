import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForbiddenState } from "../ForbiddenState";

describe("ForbiddenState", () => {
  it("says which kinds can't be listed, with each reason", () => {
    render(
      <ForbiddenState
        denied={[
          { what: "pods", reason: 'pods is forbidden: User "dev" cannot list resource "pods"' },
          { what: "nodes", reason: 'nodes is forbidden: User "dev" cannot list resource "nodes"' },
        ]}
      />,
    );
    expect(screen.getByText("You can't list pods and nodes here.")).toBeInTheDocument();
    expect(screen.getByText('pods is forbidden: User "dev" cannot list resource "pods"')).toBeInTheDocument();
    expect(screen.getByText('nodes is forbidden: User "dev" cannot list resource "nodes"')).toBeInTheDocument();
  });
});
