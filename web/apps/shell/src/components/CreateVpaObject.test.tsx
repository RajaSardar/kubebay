import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import { CreateVpaObject } from "./CreateVpaObject";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: { ...actual.api, createResource: vi.fn() },
  };
});

describe("CreateVpaObject", () => {
  beforeEach(() => {
    vi.mocked(api.createResource).mockReset();
  });

  it("requires a second (armed) click before it creates anything", () => {
    render(<CreateVpaObject cluster="kind-a" ns="prod" kind="Deployment" name="web" />);
    fireEvent.click(screen.getByRole("button", { name: /create vpa/i }));
    expect(api.createResource).not.toHaveBeenCalled();
  });

  it("creates a VerticalPodAutoscaler for the workload in updateMode Off once armed and confirmed", async () => {
    vi.mocked(api.createResource).mockResolvedValue({ applied: 1, total: 1, dryRun: false });
    render(<CreateVpaObject cluster="kind-a" ns="prod" kind="Deployment" name="web" />);

    fireEvent.click(screen.getByRole("button", { name: /create vpa/i }));
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(api.createResource).toHaveBeenCalledWith(
        expect.objectContaining({
          cluster: "kind-a",
          dryRun: false,
          yaml: expect.stringContaining('updateMode: "Off"'),
        }),
      ),
    );
  });

  it("shows a done state after a successful create", async () => {
    vi.mocked(api.createResource).mockResolvedValue({ applied: 1, total: 1, dryRun: false });
    render(<CreateVpaObject cluster="kind-a" ns="prod" kind="Deployment" name="web" />);

    fireEvent.click(screen.getByRole("button", { name: /create vpa/i }));
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/vpa created/i)).toBeTruthy());
  });

  it("shows an error message if creation fails", async () => {
    vi.mocked(api.createResource).mockRejectedValue(new Error("admission denied"));
    render(<CreateVpaObject cluster="kind-a" ns="prod" kind="Deployment" name="web" />);

    fireEvent.click(screen.getByRole("button", { name: /create vpa/i }));
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/admission denied/i)).toBeTruthy());
  });
});
