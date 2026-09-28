import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodePoolEditor } from "../NodePoolEditor";
import { api } from "../../lib/api";

const nodePoolYaml = `apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  limits:
    cpu: "1000"
    memory: 1000Gi
  disruption:
    consolidationPolicy: WhenEmpty
    budgets:
      - nodes: "10%"
`;

vi.mock("@monaco-editor/react", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button
      data-testid="editor"
      onClick={() =>
        onChange(
          `apiVersion: karpenter.sh/v1\nkind: NodePool\nmetadata:\n  name: default\nspec:\n  limits:\n    cpu: "500"\n    memory: 1000Gi\n  disruption:\n    consolidationPolicy: WhenEmpty\n    budgets:\n      - nodes: "10%"\n`,
        )
      }
    />
  ),
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

vi.mock("../../lib/theme", () => ({
  useMonacoTheme: () => "vs-dark",
}));

vi.mock("../../lib/api", () => ({
  api: {
    getYamlText: vi.fn().mockResolvedValue(""),
    applyYaml: vi.fn(),
  },
}));

vi.mocked(api.getYamlText).mockResolvedValue(nodePoolYaml);

function node(name: string, opts: { capacityType?: string } = {}) {
  return {
    metadata: {
      name,
      labels: { "karpenter.sh/nodepool": "default", ...(opts.capacityType ? { "karpenter.sh/capacity-type": opts.capacityType } : {}) },
    },
  };
}
function pod(ns: string, name: string, nodeName: string) {
  return { metadata: { namespace: ns, name }, spec: { nodeName } };
}

const props = {
  cluster: "kind-test",
  gvr: "karpenter.sh/v1/nodepools",
  name: "default",
  nodes: [node("n1"), node("n2", { capacityType: "spot" })],
  pods: [pod("team-a", "p1", "n1"), pod("team-b", "p2", "n2")],
  pdbs: [],
};

describe("NodePoolEditor", () => {
  it("shows the blast-radius impact banner computed from the pool's nodes/pods", async () => {
    render(<NodePoolEditor {...props} />);
    await screen.findByTestId("editor");
    expect(screen.getByText(/2 nodes/)).toBeTruthy();
    expect(screen.getByText(/2 pods/)).toBeTruthy();
    expect(screen.getByText(/2 namespaces/)).toBeTruthy();
    expect(screen.getByText(/1 spot/)).toBeTruthy();
  });

  it("gates Apply behind type-to-confirm when the edit shrinks spec.limits.cpu", async () => {
    render(<NodePoolEditor {...props} />);
    const editor = await screen.findByTestId("editor");
    fireEvent.click(editor);

    expect(await screen.findByText(/spec\.limits\.cpu is shrinking/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("default"), { target: { value: "default" } });
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });
});
