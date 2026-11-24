import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MAX_LOG_PODS } from "../lib/workloadLogs";

// Backlog 59: all pods of a workload in one log view.
let podRows: Record<string, unknown>[] = [];
vi.mock("../lib/useResourceStream", () => ({
  useResourceStream: (_c: string, gvr: string) => ({ rows: gvr === "v1/pods" ? podRows : [], synced: true, connected: true }),
}));
let specSeen: { pods: { pod: string; container?: string }[]; follow: boolean } | null = null;
let merged = { lines: [] as { id: number; pod: string; text: string }[], errors: {} as Record<string, string> };
vi.mock("../lib/useMergedPodLogs", () => ({
  useMergedPodLogs: (s: typeof specSeen) => {
    specSeen = s;
    return merged;
  },
}));

const { WorkloadLogs } = await import("./WorkloadLogs");

const owner = { kind: "StatefulSet", name: "db", uid: "u1", controller: true };
const mk = (name: string) => ({
  metadata: { name, namespace: "shop", creationTimestamp: "2026-01-01T00:00:00Z", resourceVersion: "1", ownerReferences: [owner] },
  spec: { containers: [{ name: "c" }] },
  status: { phase: "Running", containerStatuses: [{ name: "c", ready: true, restartCount: 0 }] },
});
const sts = { kind: "StatefulSet", metadata: { name: "db", namespace: "shop", uid: "u1" }, spec: { selector: { matchLabels: { app: "db" } } } };
const draw = () => render(<WorkloadLogs cluster="kind-test" obj={sts} />);

beforeEach(() => {
  podRows = ["db-0", "db-1", "db-2"].map(mk);
  merged = { lines: [], errors: {} };
  specSeen = null;
});

describe("WorkloadLogs", () => {
  it("follows every pod of the workload and prefixes each line with its pod", () => {
    merged = {
      lines: [
        { id: 0, pod: "db-0", text: "hello from zero" },
        { id: 1, pod: "db-1", text: "hello from one" },
      ],
      errors: {},
    };
    draw();
    expect(specSeen!.pods.map((p) => p.pod)).toEqual(["db-0", "db-1", "db-2"]);
    const line = screen.getByText("hello from one").closest(".log-line")!;
    expect(line.querySelector(".log-pod")).toHaveTextContent("db-1");
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(screen.getByText("3 pods")).toBeInTheDocument();
  });

  it("narrows to the pods a filter names, exactly when quoted", () => {
    draw();
    fireEvent.change(screen.getByPlaceholderText(/Filter pods/), { target: { value: '"db-1"' } });
    expect(specSeen!.pods.map((p) => p.pod)).toEqual(["db-1"]);
    expect(screen.getByText("Showing 1 of 3 pods")).toBeInTheDocument();
  });

  it("says when it follows only some of a large workload's pods", () => {
    podRows = Array.from({ length: MAX_LOG_PODS + 4 }, (_, i) => mk(`db-${i}`));
    draw();
    expect(specSeen!.pods).toHaveLength(MAX_LOG_PODS);
    expect(screen.getByText(`Showing ${MAX_LOG_PODS} of ${MAX_LOG_PODS + 4} pods`)).toBeInTheDocument();
  });

  it("shows only warnings and errors on request, and how many lines that hid", () => {
    merged = {
      lines: [
        { id: 0, pod: "db-0", text: "level=info msg=ok" },
        { id: 1, pod: "db-1", text: "level=error msg=bad" },
      ],
      errors: {},
    };
    draw();
    fireEvent.click(screen.getByLabelText("warnings and errors only"));
    expect(screen.queryByText("level=info msg=ok")).toBeNull();
    expect(screen.getByText("level=error msg=bad")).toBeInTheDocument();
    expect(screen.getByText("1 line hidden")).toBeInTheDocument();
  });

  it("names a pod whose stream was refused", () => {
    merged = { lines: [], errors: { "db-2": "forbidden" } };
    draw();
    expect(screen.getByText(/db-2: forbidden/)).toBeInTheDocument();
  });

  it("filters the lines by text", () => {
    merged = {
      lines: [
        { id: 0, pod: "db-0", text: "alpha" },
        { id: 1, pod: "db-1", text: "beta" },
      ],
      errors: {},
    };
    draw();
    fireEvent.change(screen.getByPlaceholderText("Filter lines…"), { target: { value: "beta" } });
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });
});
