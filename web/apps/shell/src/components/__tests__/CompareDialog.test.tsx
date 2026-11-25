import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompareHost } from "../CompareDialog";
import { useCompare } from "../../lib/compare-store";
import { api, ObjectNotFoundError } from "../../lib/api";

vi.mock("../../lib/monaco", () => ({
  default: () => <div />,
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff-editor" data-original={original} data-modified={modified} />
  ),
}));
vi.mock("../../lib/theme", async () => {
  const actual = await vi.importActual<typeof import("../../lib/theme")>("../../lib/theme");
  return { ...actual, useMonacoTheme: () => "vs-dark" };
});
vi.mock("../../lib/useObjectPicker", () => ({
  useObjectPicker: (cluster: string, q: string) => ({
    groups: q
      ? [{ slug: "deployments", label: "Deployments", total: 1, hits: [{ score: 1, obj: { cluster, slug: "deployments", ns: "shop", name: "web" } }] }]
      : [],
    loading: false,
    error: "",
  }),
}));
vi.mock("../../lib/clusterConnections", () => ({ getConnectedClusters: () => new Set(["dev", "prod"]) }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, getObjectForCompare: vi.fn() } };
});

const get = api.getObjectForCompare as unknown as ReturnType<typeof vi.fn>;
const dev = { cluster: "dev", gvr: "apps/v1/deployments", ns: "shop", name: "api", kind: "Deployment" };
const prod = { ...dev, cluster: "prod" };
const obj = (replicas: number) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "api", uid: "u-" + replicas, annotations: { team: "pay" } },
  spec: { replicas },
  status: { ready: replicas },
});
const editor = () => screen.findByTestId("diff-editor");

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((cluster: string) => Promise.resolve(obj(cluster === "dev" ? 2 : 3)));
});
afterEach(() => act(() => useCompare.getState().close()));

function show(l: typeof dev | null, r: typeof dev | null) {
  render(<CompareHost />);
  act(() => useCompare.getState().show(l, r));
}

describe("CompareDialog", () => {
  it("fetches both sides with the user's own access and diffs the normalised YAML", async () => {
    show(dev, prod);
    const ed = await editor();
    expect(get).toHaveBeenCalledWith("dev", "apps/v1/deployments", "shop", "api");
    expect(get).toHaveBeenCalledWith("prod", "apps/v1/deployments", "shop", "api");
    expect(ed.dataset.original).toContain("replicas: 2");
    expect(ed.dataset.modified).toContain("replicas: 3");
    expect(ed.dataset.original).not.toContain("uid");
    expect(ed.dataset.original).not.toContain("status");
  });

  it("Hide noise off shows uid and status", async () => {
    show(dev, prod);
    await editor();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide noise" }));
    const ed = await editor();
    expect(ed.dataset.original).toContain("uid: u-2");
    expect(ed.dataset.original).toContain("status:");
  });

  it("Swap sides exchanges the two", async () => {
    show(dev, prod);
    await editor();
    fireEvent.click(screen.getByRole("button", { name: "Swap sides" }));
    await waitFor(async () => expect((await editor()).dataset.original).toContain("replicas: 3"));
  });

  it("Copy diff puts unified diff text on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    show(dev, prod);
    await editor();
    fireEvent.click(screen.getByRole("button", { name: "Copy diff" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("--- dev: shop/api");
    expect(text).toContain("+++ prod: shop/api");
    expect(text).toContain("-  replicas: 2");
    expect(text).toContain("+  replicas: 3");
  });

  it("says plainly when the sides are equal", async () => {
    get.mockImplementation(() => Promise.resolve(obj(2)));
    show(dev, prod);
    expect(await screen.findByText(/No differences/)).toBeTruthy();
  });

  it("names a forbidden side and shows no diff", async () => {
    get.mockImplementation((cluster: string) =>
      cluster === "prod" ? Promise.reject(new Error('get: deployments.apps "api" is forbidden: cannot get')) : Promise.resolve(obj(2)),
    );
    show(dev, prod);
    expect(await screen.findByText(/not allowed to read prod: shop\/api/)).toBeTruthy();
    expect(screen.queryByTestId("diff-editor")).toBeNull();
  });

  it("says when an object is gone", async () => {
    get.mockRejectedValue(new ObjectNotFoundError("nope"));
    show(dev, prod);
    expect((await screen.findAllByText(/was not found/)).length).toBeGreaterThan(0);
  });

  it("notes that a Secret is compared by keys and sizes only", async () => {
    const s = { cluster: "dev", gvr: "v1/secrets", ns: "shop", name: "db", kind: "Secret" };
    show(s, { ...s, cluster: "prod" });
    await editor();
    expect(screen.getByText(/Secret values are never fetched/)).toBeTruthy();
  });

  it("with only one side, offers a cluster picker and a search for the other", async () => {
    show(dev, null);
    expect(get).toHaveBeenCalledTimes(1);
    const cluster = screen.getByRole("combobox", { name: "Right cluster" }) as HTMLSelectElement;
    expect([...cluster.options].map((o) => o.value)).toEqual(["dev", "prod"]);
    fireEvent.change(cluster, { target: { value: "prod" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Right search" }), { target: { value: "web" } });
    fireEvent.click(screen.getByRole("button", { name: "shop/web" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("prod", "apps/v1/deployments", "shop", "web"));
  });
});
