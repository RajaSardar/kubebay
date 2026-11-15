import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuditSecurityFeedCard } from "../AuditSecurityFeedCard";
import { securityApi, type AuditEventsResponse } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  securityApi: { auditEvents: vi.fn(), setAuditLogPath: vi.fn(), setAuditSource: vi.fn() },
}));

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AuditSecurityFeedCard cluster="kind-dev" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const configured: AuditEventsResponse = {
  configured: true,
  path: "/var/log/kube/audit.log",
  events: [
    { id: "a1", time: "2026-10-01T10:00:00Z", rule: "exec-into-pod", severity: "high", title: "Exec into pod", user: "alice", object: "pods/exec shop/api-1", allowed: true, ref: { resource: "pods", namespace: "shop", name: "api-1" } },
    { id: "a2", time: "2026-10-01T09:00:00Z", rule: "cluster-admin-binding", severity: "high", title: "Binding to cluster-admin", user: "bob", object: "clusterrolebindings oops", detail: "grants cluster-admin to User mallory", allowed: false },
  ],
};

beforeEach(() => {
  vi.mocked(securityApi.auditEvents).mockReset();
  vi.mocked(securityApi.setAuditLogPath).mockReset();
  vi.mocked(securityApi.setAuditSource).mockReset().mockResolvedValue({ ok: true });
});

describe("AuditSecurityFeedCard", () => {
  it("explains the precondition and saves a path when none is set", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValueOnce({ configured: false, events: [] }).mockResolvedValue(configured);
    vi.mocked(securityApi.setAuditLogPath).mockResolvedValue({ ok: true, path: "/var/log/kube/audit.log" });
    renderCard();
    expect(await screen.findByText(/needs the API server's audit log/)).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Audit log path"), { target: { value: "/var/log/kube/audit.log" } });
    fireEvent.click(screen.getByRole("button", { name: "Save path" }));
    await waitFor(() => expect(securityApi.setAuditLogPath).toHaveBeenCalledWith("kind-dev", "/var/log/kube/audit.log"));
    expect(await screen.findByText("Exec into pod")).toBeInTheDocument();
  });

  it("lists events newest first with who, what and whether it was allowed", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue(configured);
    renderCard();
    expect(await screen.findByText("Exec into pod")).toBeInTheDocument();
    expect(screen.getByText("pods/exec shop/api-1")).toBeInTheDocument();
    expect(screen.getByText("grants cluster-admin to User mallory")).toBeInTheDocument();
    expect(screen.getByText("allowed")).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
    expect(screen.getByText(/\/var\/log\/kube\/audit\.log/)).toBeInTheDocument();
  });

  it("shows why a configured log couldn't be read", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue({ configured: true, path: "/x.log", error: "open /x.log: permission denied", events: [] });
    renderCard();
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });

  it("filters to one severity", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue({
      ...configured,
      events: [...configured.events, { id: "a3", time: "t", rule: "secret-read", severity: "low", title: "Secret read by a person", user: "carol", object: "secrets shop/db", allowed: true }],
    });
    renderCard();
    expect(await screen.findByText("Secret read by a person")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
    expect(screen.queryByText("Secret read by a person")).toBeNull();
    expect(screen.getByText("Exec into pod")).toBeInTheDocument();
  });

  it("shows why the feed is off in an OIDC or in-cluster deployment, with no path field", async () => {
    vi.mocked(securityApi.auditEvents).mockRejectedValue(new Error("the audit feed reads a file on the engine host, so it is off when OIDC is configured"));
    renderCard();
    expect(await screen.findByText(/off when OIDC is configured/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Audit log path")).toBeNull();
  });

  it("links an event to the object it touched", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue(configured);
    renderCard();
    const link = await screen.findByRole("link", { name: "pods/exec shop/api-1" });
    expect(link).toHaveAttribute("href", "/workloads?pod=shop%2Fapi-1");
    expect(screen.queryByRole("link", { name: "clusterrolebindings oops" })).toBeNull();
  });

  it("shows a burst of Secret reads as one row with its count and span", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue({
      configured: true,
      path: "/var/log/kube/audit.log",
      events: [
        {
          id: "s9",
          time: "2026-10-01T10:02:00Z",
          firstTime: "2026-10-01T10:00:00Z",
          count: 25,
          rule: "secret-read",
          severity: "medium",
          title: "Burst of Secret reads by a person",
          user: "alice",
          object: "secrets shop/*",
          detail: "25 reads of 3 Secrets: shop/a, shop/b, shop/c",
          allowed: true,
        },
      ],
    });
    renderCard();
    expect(await screen.findByText("Burst of Secret reads by a person")).toBeInTheDocument();
    expect(screen.getByText("×25")).toBeInTheDocument();
    expect(screen.getByText("since 2026-10-01T10:00:00Z")).toBeInTheDocument();
  });

  it("reads an EKS cluster's audit log from CloudWatch through the aws CLI", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue({ configured: false, events: [] });
    renderCard();
    fireEvent.change(await screen.findByLabelText("Audit log source"), { target: { value: "eks" } });
    expect(screen.getByText(/control plane audit logging/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("EKS cluster name"), { target: { value: "prod" } });
    fireEvent.change(screen.getByLabelText("AWS region"), { target: { value: "eu-west-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save source" }));
    await waitFor(() => expect(securityApi.setAuditSource).toHaveBeenCalledWith("kind-dev", { kind: "eks", cluster: "prod", region: "eu-west-1" }));
    expect(securityApi.setAuditLogPath).not.toHaveBeenCalled();
  });

  it("reads a GKE cluster's Cloud Audit Logs through gcloud", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue({ configured: false, events: [] });
    renderCard();
    fireEvent.change(await screen.findByLabelText("Audit log source"), { target: { value: "gke" } });
    expect(screen.getByText(/Data Access logs/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save source" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Google Cloud project"), { target: { value: "my-proj" } });
    fireEvent.change(screen.getByLabelText("GKE location"), { target: { value: "europe-west1" } });
    fireEvent.change(screen.getByLabelText("GKE cluster name"), { target: { value: "prod" } });
    fireEvent.click(save);
    await waitFor(() => expect(securityApi.setAuditSource).toHaveBeenCalledWith("kind-dev", { kind: "gke", project: "my-proj", location: "europe-west1", cluster: "prod" }));
  });

  it("opens Change on the cloud source it is reading", async () => {
    vi.mocked(securityApi.auditEvents).mockResolvedValue({
      configured: true,
      source: "eks",
      path: "CloudWatch /aws/eks/prod/cluster (eu-west-1)",
      cloud: { kind: "eks", cluster: "prod", region: "eu-west-1" },
      events: [],
    });
    renderCard();
    expect(await screen.findByText("CloudWatch /aws/eks/prod/cluster (eu-west-1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByLabelText("Audit log source")).toHaveValue("eks");
    expect(screen.getByLabelText("EKS cluster name")).toHaveValue("prod");
  });
});
