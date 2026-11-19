import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChartsTab } from "../HelmCharts";
import { helmMarketApi, type HelmChartDetail } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  helmMarketApi: {
    repos: vi.fn(),
    charts: vi.fn(),
    chart: vi.fn(),
    chartValuesText: vi.fn(),
    updateRepos: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
  },
}));
vi.mock("../../lib/monaco", () => ({ default: () => <div data-testid="editor" />, DiffEditor: () => <div /> }));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ChartsTab cluster="c1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(helmMarketApi.repos).mockResolvedValue([{ name: "store", url: "https://charts.example.com" }]);
  vi.mocked(helmMarketApi.charts).mockResolvedValue([{ name: "redis", version: "1.0.0", description: "", versions: 1 }]);
  vi.mocked(helmMarketApi.chartValuesText).mockResolvedValue("a: 1\n");
});

describe("Add repository", () => {
  it("sends the name, URL and optional basic auth, then refreshes the repo list", async () => {
    vi.mocked(helmMarketApi.addRepo).mockResolvedValue({ name: "priv", url: "https://priv.example.com" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    fireEvent.change(screen.getByLabelText("Repository name"), { target: { value: "priv" } });
    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://priv.example.com" } });
    fireEvent.change(screen.getByLabelText("Username (optional)"), { target: { value: "ada" } });
    const pw = screen.getByLabelText("Password (optional)");
    expect(pw).toHaveAttribute("type", "password");
    fireEvent.change(pw, { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(helmMarketApi.addRepo).toHaveBeenCalledWith({ name: "priv", url: "https://priv.example.com", username: "ada", password: "s3cret" }),
    );
    await waitFor(() => expect(helmMarketApi.repos).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Repository URL")).toBeNull();
  });

  it("leaves credentials out when none were typed", async () => {
    vi.mocked(helmMarketApi.addRepo).mockResolvedValue({ name: "p", url: "https://p.example.com" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    fireEvent.change(screen.getByLabelText("Repository name"), { target: { value: "p" } });
    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://p.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(helmMarketApi.addRepo).toHaveBeenCalledWith({ name: "p", url: "https://p.example.com" }));
  });

  it("shows the engine's refusal plainly and keeps the form", async () => {
    vi.mocked(helmMarketApi.addRepo).mockRejectedValue(new Error("repository URL: the host resolves to a blocked address"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    fireEvent.change(screen.getByLabelText("Repository name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "http://169.254.169.254" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/resolves to a blocked address/)).toBeInTheDocument();
    expect(screen.getByLabelText("Repository URL")).toHaveValue("http://169.254.169.254");
  });

  it("will not submit without a name and a URL", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});

describe("Remove repository", () => {
  it("asks first, then removes the selected repo and refreshes", async () => {
    vi.mocked(helmMarketApi.removeRepo).mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Remove repository" }));
    expect(helmMarketApi.removeRepo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove store" }));
    await waitFor(() => expect(helmMarketApi.removeRepo).toHaveBeenCalledWith("store"));
    await waitFor(() => expect(helmMarketApi.repos).toHaveBeenCalledTimes(2));
  });

  it("shows why a removal failed", async () => {
    vi.mocked(helmMarketApi.removeRepo).mockRejectedValue(new Error('repository "store" is not configured'));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Remove repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove store" }));
    expect(await screen.findByText(/is not configured/)).toBeInTheDocument();
  });
});

describe("Chart cards", () => {
  it("show a letter avatar, and never an image from the chart's repo", async () => {
    mount();
    await screen.findByText("redis");
    expect(document.querySelector(".kb-avatar")?.textContent).toBe("R");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("README", () => {
  it("renders Markdown without loading images or running anything", async () => {
    const detail: HelmChartDetail = {
      repo: "store",
      name: "redis",
      version: "1.0.0",
      description: "",
      versions: [{ version: "1.0.0" }],
      readme: "# Redis\n\n![badge](https://img.shields.io/x.svg) see [docs](https://example.com) <script>alert(1)</script>",
    } as HelmChartDetail;
    vi.mocked(helmMarketApi.chart).mockResolvedValue(detail);
    mount();
    fireEvent.click(await screen.findByText("redis"));
    fireEvent.click(await screen.findByRole("tab", { name: "README" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Redis" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(document.querySelector("img, script")).toBeNull();
  });
});
