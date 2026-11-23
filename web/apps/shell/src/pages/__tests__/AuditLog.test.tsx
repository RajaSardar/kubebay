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
        namespace: "example-consumers",
        resource: "example-consumer-xyz",
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
          namespace: "example-consumers",
          resource: "example-consumer-xyz",
          detail: "pod deleted by user admin",
          userAgent: "kubectl/v1.28.0",
          user: "alice@example.com",
          gvr: "v1/pods",
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
    expect(dialog).toHaveTextContent("example-consumers");
    expect(dialog).toHaveTextContent("example-consumer-xyz");
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

  it("shows who acted in a User column, and the user and kind in the detail modal", () => {
    render(<AuditLog />);
    expect(screen.getByRole("columnheader", { name: "User" })).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByText("delete"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("alice@example.com");
    expect(dialog).toHaveTextContent("v1/pods");
  });

  it("filters by user", () => {
    render(<AuditLog />);
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: "bob@" } });
    expect(screen.queryByText("delete")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: "alice@" } });
    expect(screen.getByText("delete")).toBeInTheDocument();
  });
});
