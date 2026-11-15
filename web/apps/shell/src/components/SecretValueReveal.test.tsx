import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { secretApi } from "../lib/api";
import { SecretValueReveal } from "./SecretValueReveal";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, secretApi: { ...actual.secretApi, revealValue: vi.fn() } };
});

describe("SecretValueReveal", () => {
  beforeEach(() => {
    vi.mocked(secretApi.revealValue).mockReset();
  });

  it("shows a masked placeholder and never fetches until clicked", () => {
    render(<SecretValueReveal cluster="kind-a" ns="prod" name="db-creds" secretKey="password" />);
    expect(screen.getByText(/secret\(db-creds\)\[password\]/)).toBeTruthy();
    expect(secretApi.revealValue).not.toHaveBeenCalled();
  });

  it("fetches and reveals the value on click", async () => {
    vi.mocked(secretApi.revealValue).mockResolvedValue({ value: "hunter2" });
    render(<SecretValueReveal cluster="kind-a" ns="prod" name="db-creds" secretKey="password" />);

    fireEvent.click(screen.getByRole("button", { name: /show/i }));

    expect(secretApi.revealValue).toHaveBeenCalledWith({ cluster: "kind-a", ns: "prod", name: "db-creds", key: "password" });
    await waitFor(() => expect(screen.getByText("hunter2")).toBeTruthy());
    expect(screen.queryByText(/secret\(db-creds\)\[password\]/)).toBeNull();
  });

  it("shows an error state when the reveal fails", async () => {
    vi.mocked(secretApi.revealValue).mockRejectedValue(new Error("forbidden"));
    render(<SecretValueReveal cluster="kind-a" ns="prod" name="db-creds" secretKey="password" />);

    fireEvent.click(screen.getByRole("button", { name: /show/i }));

    await waitFor(() => expect(screen.getByText(/forbidden/i)).toBeTruthy());
  });

  it("does not decode again on a second click once already revealed", async () => {
    vi.mocked(secretApi.revealValue).mockResolvedValue({ value: "hunter2" });
    render(<SecretValueReveal cluster="kind-a" ns="prod" name="db-creds" secretKey="password" />);

    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    await waitFor(() => expect(screen.getByText("hunter2")).toBeTruthy());

    expect(secretApi.revealValue).toHaveBeenCalledTimes(1);
  });
});
