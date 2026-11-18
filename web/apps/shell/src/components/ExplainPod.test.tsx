import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rows: unknown[] = [];
vi.mock("../lib/useResourceStream", () => ({ useResourceStream: () => ({ rows }) }));
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => ({ ...(await vi.importActual<object>("react-router-dom")), useNavigate: () => navigateMock }));

import { ExplainPod } from "./ExplainPod";

const crash = {
  metadata: { name: "web-1", namespace: "prod" },
  spec: { nodeName: "n1", containers: [{ name: "app", image: "a" }] },
  status: { phase: "Running", containerStatuses: [{ name: "app", ready: false, restartCount: 5, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "Error", exitCode: 1 } } }] },
};

function r(obj: Record<string, unknown>, onOpen = vi.fn()) {
  render(
    <MemoryRouter>
      <ExplainPod obj={obj} cluster="c" onOpenTab={onOpen} />
    </MemoryRouter>,
  );
  return onOpen;
}

describe("ExplainPod", () => {
  it("renders nothing for a healthy pod", () => {
    const { container } = render(
      <MemoryRouter>
        <ExplainPod obj={{ metadata: { name: "p" }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } }} cluster="c" onOpenTab={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });

  it("shows the diagnosis and where it was read", () => {
    r(crash);
    expect(screen.getByText(/exit code 1/)).toBeTruthy();
    expect(screen.getByText(/containerStatuses/)).toBeTruthy();
  });

  it("the previous-logs step opens the Logs tab on the previous container", () => {
    const open = r(crash);
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(open).toHaveBeenCalledWith("logs", { container: "app", previous: true });
  });
});
