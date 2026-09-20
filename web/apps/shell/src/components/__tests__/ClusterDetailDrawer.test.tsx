import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClusterDetailDrawer } from "../ClusterDetailDrawer";
import type { ClusterInfo } from "../../lib/api";

// TDD: Ensures the remove-from-list flow requires explicit confirmation
// before calling onRemove(). Mirrors Freelens's delete confirmation pattern
// but without touching kubeconfig.

const mockCluster: ClusterInfo = {
  id: "arn:aws:eks:us-east-1:123:cluster/prod",
  context: "prod-context",
  server: "https://10.0.0.1:6443",
  status: "connected",
  version: "1.28",
};

const defaultProps = {
  cluster: mockCluster,
  meta: {},
  icon: { bg: "#0ea5e9", label: "P" },
  isActive: false,
  onConnect: vi.fn(),
  onClose: vi.fn(),
  onRename: vi.fn(),
  onChangeIcon: vi.fn(),
  onTogglePin: vi.fn(),
  onRemove: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ClusterDetailDrawer – remove confirmation", () => {
  it("does not call onRemove immediately when Remove from list is clicked", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /remove from list/i }));
    expect(defaultProps.onRemove).not.toHaveBeenCalled();
  });

  it("shows confirmation text after clicking Remove from list", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /remove from list/i }));
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it("calls onRemove after confirming", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /remove from list/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(defaultProps.onRemove).toHaveBeenCalledOnce();
  });

  it("cancels without calling onRemove when Cancel is clicked", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /remove from list/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(defaultProps.onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
  });
});

describe("ClusterDetailDrawer – metadata display", () => {
  it("shows cluster context in metadata", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    // context appears in name row (displayName fallback) and in metadata dd
    expect(screen.getAllByText("prod-context").length).toBeGreaterThanOrEqual(1);
  });

  it("shows cluster server", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    expect(screen.getByText("https://10.0.0.1:6443")).toBeInTheDocument();
  });

  it("shows version when provided", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    expect(screen.getByText("1.28")).toBeInTheDocument();
  });

  it("shows Connect button for non-active cluster", () => {
    render(<ClusterDetailDrawer {...defaultProps} isActive={false} />);
    expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
  });

  it("shows Reconnect button for the currently active cluster", () => {
    render(<ClusterDetailDrawer {...defaultProps} isActive={true} />);
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeInTheDocument();
  });

  it("calls onConnect when Connect is clicked", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    expect(defaultProps.onConnect).toHaveBeenCalledOnce();
  });

  it("calls onClose when close button is clicked", () => {
    render(<ClusterDetailDrawer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });
});
