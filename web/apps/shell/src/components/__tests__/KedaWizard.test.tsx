import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KedaWizard } from "../KedaWizard";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="editor" />,
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

vi.mock("../../lib/theme", () => ({
  useMonacoTheme: () => "vs-dark",
}));

vi.mock("../../lib/api", () => ({
  api: {
    createResource: vi.fn().mockResolvedValue({ applied: 1, total: 1, dryRun: false }),
  },
}));

const props = {
  cluster: "kind-test",
  ns: "team-a",
  targetKind: "Deployment" as const,
  targetName: "checkout",
  hpas: [] as Record<string, unknown>[],
};

describe("KedaWizard", () => {
  it("defaults to a CPU trigger with sensible replica bounds and previews the generated manifest", () => {
    render(<KedaWizard {...props} />);
    expect(screen.getByTestId("diff-editor")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });

  it("blocks Dry-run and Apply when an HPA already targets the same workload", () => {
    render(<KedaWizard {...props} hpas={[{ metadata: { namespace: "team-a", name: "checkout-hpa" }, spec: { scaleTargetRef: { name: "checkout", kind: "Deployment" } } }]} />);
    expect(screen.getByText(/dual ownership causes replica flapping/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /dry-run/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
  });

  it("requires typing the target name to confirm before Apply when minReplicaCount is set to 0", () => {
    render(<KedaWizard {...props} />);
    fireEvent.change(screen.getByLabelText(/min replicas/i), { target: { value: "0" } });

    expect(screen.getByText(/scale.to.zero/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
    // Dry-run stays available since previewing a scale-to-zero config is harmless.
    expect(screen.getByRole("button", { name: /dry-run/i })).not.toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("checkout"), { target: { value: "checkout" } });
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });

  it("submits the generated YAML via api.createResource on Apply", async () => {
    render(<KedaWizard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/applied/i)).toBeTruthy();
    const call = vi.mocked(api.createResource).mock.calls[0]![0];
    expect(call.cluster).toBe("kind-test");
    expect(call.dryRun).toBe(false);
    expect(call.yaml).toContain("kind: ScaledObject");
    expect(call.yaml).toContain("namespace: team-a");
  });

  it("switches to a prometheus trigger, suggests discovered Service candidates, and validates its fields", () => {
    render(
      <KedaWizard
        {...props}
        services={[
          { metadata: { name: "prometheus-server", namespace: "monitoring", labels: {} }, spec: { ports: [{ port: 9090 }] } },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/trigger/i), { target: { value: "prometheus" } });

    expect(screen.getByText(/never the same as kubebay's local prometheus proxy/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/server address/i), { target: { value: "http://prometheus-server.monitoring.svc:9090" } });
    fireEvent.change(screen.getByLabelText(/promql query/i), { target: { value: "up" } });
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });

  it("switches to a cron trigger and requires start/end before submitting", () => {
    render(<KedaWizard {...props} />);
    fireEvent.change(screen.getByLabelText(/trigger/i), { target: { value: "cron" } });

    expect(screen.getByText(/cron trigger needs both a start and end schedule/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: "0 9 * * 1-5" } });
    fireEvent.change(screen.getByLabelText(/end/i), { target: { value: "0 18 * * 1-5" } });
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });

  it("renders the structured PolicyRejectionCard instead of a raw error string on a 422 rejection (backlog #17)", async () => {
    vi.mocked(api.createResource).mockRejectedValueOnce(
      new PolicyRejectionError({ engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required" }),
    );
    render(<KedaWizard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/kyverno policy rejected this change/i)).toBeTruthy();
    expect(screen.getByText("validate.kyverno.svc-fail")).toBeTruthy();
  });
});
