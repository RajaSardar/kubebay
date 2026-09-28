import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PolicyRejectionCard } from "../PolicyRejectionCard";

describe("PolicyRejectionCard", () => {
  it("names the engine and webhook when known", () => {
    render(<PolicyRejectionCard rejection={{ engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required" }} />);
    expect(screen.getByText(/kyverno policy rejected this change/i)).toBeTruthy();
    expect(screen.getByText("validate.kyverno.svc-fail")).toBeTruthy();
    expect(screen.getByText("label 'team' is required")).toBeTruthy();
  });

  it("falls back to a generic title when the engine is unrecognized", () => {
    render(<PolicyRejectionCard rejection={{ engine: "", webhook: "my-custom-webhook.example.com", message: "nope" }} />);
    expect(screen.getByText(/^policy rejected this change$/i)).toBeTruthy();
  });

  it("lists structured causes with their field when present", () => {
    render(
      <PolicyRejectionCard
        rejection={{
          engine: "kyverno",
          webhook: "validate.kyverno.svc-fail",
          message: "blocked",
          causes: [{ field: "metadata.labels.team", message: "is required" }],
        }}
      />,
    );
    expect(screen.getByText(/metadata\.labels\.team/)).toBeTruthy();
    expect(screen.getByText(/is required/)).toBeTruthy();
  });

  it("renders nothing extra when there are no causes", () => {
    render(<PolicyRejectionCard rejection={{ engine: "kyverno", webhook: "x", message: "blocked" }} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
