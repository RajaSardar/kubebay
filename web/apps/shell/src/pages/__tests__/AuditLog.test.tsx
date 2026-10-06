import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AuditLog from "../AuditLog";

vi.mock("../../lib/api", () => ({
  api: {
    auditLog: vi.fn().mockResolvedValue([
      {
        time: "2026-10-06T10:00:00Z",
        action: "delete",
        cluster: "prod-eks",
        namespace: "platform-consumers",
        resource: "device-testing-consumer-xyz",
        detail: "pod deleted by user admin",
        userAgent: "kubectl/v1.28.0",
      },
    ]),
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({
      data: [
        {
          time: "2026-10-06T10:00:00Z",
          action: "delete",
          cluster: "prod-eks",
          namespace: "platform-consumers",
          resource: "device-testing-consumer-xyz",
          detail: "pod deleted by user admin",
          userAgent: "kubectl/v1.28.0",
        },
      ],
      isLoading: false,
      isError: false,
    }),
  };
});

describe("AuditLog — row click shows full details (backlog #4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a detail modal when clicking an audit log row", () => {
    render(<AuditLog />);
    fireEvent.click(screen.getByText("delete"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("detail modal shows all entry fields including userAgent", () => {
    render(<AuditLog />);
    fireEvent.click(screen.getByText("delete"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("prod-eks");
    expect(dialog).toHaveTextContent("platform-consumers");
    expect(dialog).toHaveTextContent("device-testing-consumer-xyz");
    expect(dialog).toHaveTextContent("pod deleted by user admin");
    expect(dialog).toHaveTextContent("kubectl/v1.28.0");
  });

  it("closes the detail modal via the close button", () => {
    render(<AuditLog />);
    fireEvent.click(screen.getByText("delete"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
