import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrphanedSecretsCard } from "./OrphanedSecretsCard";

describe("OrphanedSecretsCard", () => {
  it("shows an all-clear message when every Secret is referenced", () => {
    render(<OrphanedSecretsCard secrets={[]} />);
    expect(screen.getByText(/every secret is referenced/i)).toBeTruthy();
  });

  it("lists each unreferenced Secret with its namespace and a count badge", () => {
    render(
      <OrphanedSecretsCard
        secrets={[
          { namespace: "shop", name: "old-creds", createdAt: "2026-01-01T00:00:00Z" },
          { namespace: "billing", name: "stripe-test", createdAt: "" },
        ]}
      />,
    );
    expect(screen.getByText("old-creds")).toBeTruthy();
    expect(screen.getByText("stripe-test")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("warns that references from custom resources aren't checked", () => {
    render(<OrphanedSecretsCard secrets={[{ namespace: "shop", name: "x", createdAt: "" }]} />);
    expect(screen.getByText(/custom resources/i)).toBeTruthy();
  });
});
