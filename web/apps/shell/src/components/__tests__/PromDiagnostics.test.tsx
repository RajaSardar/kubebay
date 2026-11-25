import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { PromNotFound, PromTestPanel } from "../PromDiagnostics";
import * as api from "../../lib/api";

vi.mock("../../lib/api");

beforeEach(() => vi.clearAllMocks());

function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

const none: api.PromStatus = {
  source: "none",
  target: "",
  chosen: false,
  candidates: [],
  scope: "namespaces",
  tried: ["monitoring", "prometheus"],
  forbidden: ["prometheus"],
};

describe("PromNotFound", () => {
  it("says what was tried and where listing was refused, and offers the three ways out", async () => {
    const onChoose = vi.fn();
    const onEnterUrl = vi.fn();
    const user = userEvent.setup();
    render(<PromNotFound cluster="dev" status={none} onChoose={onChoose} onEnterUrl={onEnterUrl} />);
    expect(screen.getByText(/Prometheus: not found/)).toBeTruthy();
    expect(screen.getByText(/Tried: monitoring, prometheus/)).toBeTruthy();
    expect(screen.getByText(/Not allowed to list Services in: prometheus/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Choose a Service" }));
    await user.click(screen.getByRole("button", { name: "Enter URL" }));
    expect(onChoose).toHaveBeenCalled();
    expect(onEnterUrl).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeTruthy();
  });

  it("says every Service was looked at when the whole cluster could be listed", () => {
    render(<PromNotFound cluster="dev" status={{ ...none, scope: "cluster", tried: [], forbidden: [] }} onChoose={() => {}} onEnterUrl={() => {}} />);
    expect(screen.getByText(/looked at every Service in the cluster/i)).toBeTruthy();
  });
});

describe("PromTestPanel", () => {
  it("shows the exact URL, query and HTTP status of each check", async () => {
    vi.mocked(api.promApi.test).mockResolvedValue({
      ok: false,
      source: "auto",
      cause: "forbidden",
      message: "Forbidden: your account may not use services/proxy in monitoring.",
      checks: [{ query: "vector(1)", url: "/api/v1/namespaces/monitoring/services/prometheus-server:80/proxy/api/v1/query?query=vector%281%29", httpStatus: 403, series: 0 }],
    });
    const user = userEvent.setup();
    render(<PromTestPanel cluster="dev" />);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText(/services\/proxy in monitoring/)).toBeTruthy());
    expect(screen.getByText(/HTTP 403/)).toBeTruthy();
    expect(screen.getByText(/proxy\/api\/v1\/query\?query=vector/)).toBeTruthy();
    expect(screen.getByText(/vector\(1\)/)).toBeTruthy();
    expect(api.promApi.test).toHaveBeenCalledWith("dev", undefined);
  });

  it("shows a transport error where there is no HTTP status", async () => {
    vi.mocked(api.promApi.test).mockResolvedValue({
      ok: false, source: "manual", cause: "unreachable", message: "Could not connect: connection refused.",
      checks: [{ query: "vector(1)", url: "http://localhost:9090/api/v1/query?query=vector%281%29", httpStatus: 0, series: 0, error: "connection refused" }],
    });
    const user = userEvent.setup();
    render(<PromTestPanel cluster="dev" />);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getAllByText(/connection refused/).length).toBeGreaterThan(0));
  });

  it("says so when the test itself could not be run", async () => {
    vi.mocked(api.promApi.test).mockRejectedValue(new Error("engine down"));
    const user = userEvent.setup();
    render(<PromTestPanel cluster="dev" />);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText(/engine down/)).toBeTruthy());
  });
});
