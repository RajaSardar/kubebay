import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ADR 0004 S5: Helm releases load in the background when a cluster connects.
// The release Secrets' metadata streams from the start (cheap: one small
// object per live revision), and the release list, which the engine decodes,
// is fetched once there are releases to show.

const helmSecrets = vi.hoisted(() => ({ value: { rows: [] as unknown[], synced: false } }));
vi.mock("../useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string | undefined, gvr: string) => (gvr === "v1/secrets" ? helmSecrets.value : { rows: [], synced: false })),
}));
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  helmApi: { releases: vi.fn(async () => []) },
}));

const { useResourceStream } = await import("../useResourceStream");
const { helmApi } = await import("../api");
const { usePrewarm } = await import("../usePrewarm");

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

const release = { metadata: { namespace: "shop", name: "sh.helm.release.v1.web.v2", labels: { owner: "helm", name: "web", version: "2", status: "deployed" } } };

describe("usePrewarm and Helm", () => {
  beforeEach(() => {
    vi.mocked(useResourceStream).mockClear();
    vi.mocked(helmApi.releases).mockClear();
    helmSecrets.value = { rows: [], synced: false };
  });

  it("streams the release Secrets' metadata, live revisions only", () => {
    renderHook(() => usePrewarm("c1"), { wrapper });
    expect(useResourceStream).toHaveBeenCalledWith("c1", "v1/secrets", { mode: "metadata", labelSelector: "owner=helm,status!=superseded" });
  });

  it("fetches the release list in the background once the cluster has releases", async () => {
    helmSecrets.value = { rows: [release], synced: true };
    renderHook(() => usePrewarm("c1"), { wrapper });
    await waitFor(() => expect(helmApi.releases).toHaveBeenCalledWith("c1"));
  });

  it("doesn't ask for the list on a cluster with no releases", async () => {
    helmSecrets.value = { rows: [], synced: true };
    renderHook(() => usePrewarm("c1"), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(helmApi.releases).not.toHaveBeenCalled();
  });
});
