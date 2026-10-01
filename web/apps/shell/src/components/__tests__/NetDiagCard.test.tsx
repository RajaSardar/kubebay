import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NetDiagCard } from "../NetDiagCard";
import { api, netdiagApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  netdiagApi: { start: vi.fn() },
  api: { deleteResource: vi.fn(async () => ({})) },
}));
vi.mock("../heavy", () => ({
  ExecTerm: (p: { namespace: string; pod: string; container: string }) => (
    <div>{`exec ${p.pod} in ${p.namespace}/${p.container}`}</div>
  ),
}));

async function start() {
  fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "shop" } });
  fireEvent.click(screen.getByRole("button", { name: "Start diagnostic pod" }));
  fireEvent.click(screen.getByRole("button", { name: /Create a pod in shop\?/ }));
  return screen.findByText("exec kubebay-netdiag-1 in shop/netdiag");
}

describe("NetDiagCard", () => {
  beforeEach(() => {
    vi.mocked(netdiagApi.start).mockReset().mockResolvedValue({ namespace: "shop", pod: "kubebay-netdiag-1" });
    vi.mocked(api.deleteResource).mockClear();
  });

  it("starts a pod in the chosen namespace after confirmation and opens a terminal in it", async () => {
    render(<NetDiagCard cluster="c1" namespaces={["default", "shop"]} />);
    expect(screen.getByText(/no privileges and no API token/i)).toBeInTheDocument();
    await start();
    expect(netdiagApi.start).toHaveBeenCalledWith({ cluster: "c1", namespace: "shop" });
  });

  it("passes a custom image when one is given", async () => {
    render(<NetDiagCard cluster="c1" namespaces={["shop"]} />);
    fireEvent.change(screen.getByLabelText("Image"), { target: { value: "mirror.local/netshoot:1" } });
    await start();
    expect(netdiagApi.start).toHaveBeenCalledWith({ cluster: "c1", namespace: "shop", image: "mirror.local/netshoot:1" });
  });

  it("deletes the pod on Stop", async () => {
    render(<NetDiagCard cluster="c1" namespaces={["shop"]} />);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Stop and delete pod" }));
    await waitFor(() =>
      expect(api.deleteResource).toHaveBeenCalledWith({ cluster: "c1", gvr: "v1/pods", ns: "shop", name: "kubebay-netdiag-1" }),
    );
    expect(screen.queryByText(/exec kubebay-netdiag-1/)).not.toBeInTheDocument();
  });

  it("deletes the pod when the card goes away", async () => {
    const { unmount } = render(<NetDiagCard cluster="c1" namespaces={["shop"]} />);
    await start();
    unmount();
    expect(api.deleteResource).toHaveBeenCalledWith({ cluster: "c1", gvr: "v1/pods", ns: "shop", name: "kubebay-netdiag-1" });
  });

  it("shows why a start failed", async () => {
    vi.mocked(netdiagApi.start).mockRejectedValue(new Error("ImagePullBackOff: not found"));
    render(<NetDiagCard cluster="c1" namespaces={["shop"]} />);
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Start diagnostic pod" }));
    fireEvent.click(screen.getByRole("button", { name: /Create a pod in shop\?/ }));
    expect(await screen.findByText(/ImagePullBackOff: not found/)).toBeInTheDocument();
  });
});
