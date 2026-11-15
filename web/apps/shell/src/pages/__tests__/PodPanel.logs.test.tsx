import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Backlog #22: the Logs tab colours each line by its level, renders an app's
// own ANSI colours instead of showing escape codes, and filters on the text
// you see.

vi.mock("../../components/heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../../components/PodSummary", () => ({ PodSummary: () => null }));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  imageSigApi: { check: vi.fn(async () => []) },
  triageApi: { get: vi.fn(async () => ({ enabled: false, clusters: [], baseURL: "", model: "", key: { source: "", store: "" } })) },
}));
const lines = [
  '{"level":"error","msg":"db down"}',
  "10:00:00 WARN slow query",
  "Migration completed successfully",
  "10:00:00 DEBUG cache miss",
  "\x1b[31mERROR\x1b[0m from an app that colours its own",
  "served 0 errors in the last hour",
];
vi.mock("../../lib/usePodLogs", () => ({ usePodLogs: () => ({ lines, status: "streaming", error: "" }) }));

const { default: PodPanel } = await import("../PodPanel");

const pod = { cluster: "kind-test", namespace: "shop", pod: "api-1", containers: ["app"], obj: { metadata: { name: "api-1" } }, tab: "logs" as const };
const line = (text: string | RegExp) => screen.getByText(text, { selector: ".log-line, .log-line *" }).closest(".log-line")!;

describe("PodPanel logs", () => {
  it("colours each line by its level", () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    expect(line('{"level":"error","msg":"db down"}')).toHaveClass("err");
    expect(line("10:00:00 WARN slow query")).toHaveClass("warn");
    expect(line("Migration completed successfully")).toHaveClass("ok");
    expect(line("10:00:00 DEBUG cache miss")).toHaveClass("debug");
    expect(line("served 0 errors in the last hour").className).toBe("log-line");
  });

  it("shows an app's own colours, never its escape codes", () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    const coloured = line(/from an app that colours its own/);
    expect(coloured).toHaveClass("err");
    expect(coloured.textContent).toBe("ERROR from an app that colours its own");
    expect(coloured.querySelector(".log-ansi-err")).toHaveTextContent("ERROR");
  });

  it("filters on the text you see", () => {
    render(<PodPanel pod={pod} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Filter lines…"), { target: { value: "ERROR from" } });
    expect(screen.getAllByText(/./, { selector: ".log-line" })).toHaveLength(1);
  });
});
