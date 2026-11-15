import { expect, test } from "@playwright/test";

// KB-12's acceptance: the Dynamic Resource Allocation tables render against a
// kind cluster running the DRA example driver (gpu.example.com, 8 GPUs per
// node), with fixtures/dra-claim.yaml's claim allocated to its pod.
const token = process.env.KUBEBAY_TOKEN ?? "e2e-token";
const kubeContext = process.env.KUBEBAY_E2E_CONTEXT ?? "kind-kubebay-dra";
const worker = process.env.KUBEBAY_E2E_DRA_NODE ?? "kubebay-dra-worker";

test("DRA: the example driver's class, slices and an allocated claim", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // The golden path covers the token prompt; here the token is handed over the
  // way the desktop app does it.
  await page.addInitScript((t) => {
    (window as unknown as { __KUBEBAY_TOKEN__: string }).__KUBEBAY_TOKEN__ = t;
  }, token);

  await test.step("open the cluster", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/clusters/);
    await page.getByRole("row").filter({ hasText: kubeContext }).first().click();
    await expect(page).toHaveURL(/\/workloads-overview/);
  });

  const row = (text: string) => page.getByRole("row").filter({ hasText: text }).first();

  await test.step("DeviceClasses: the driver's class, and the driver its selector pins", async () => {
    await page.goto("/r/deviceclasses");
    // Its name, then the driver its CEL selector pins: the same string twice.
    await expect(row("gpu.example.com")).toHaveText(/gpu\.example\.com.*gpu\.example\.com/);
  });

  await test.step("ResourceSlices: the worker's pool of 8 GPUs", async () => {
    await page.goto("/r/resourceslices");
    const slice = row(worker);
    await expect(slice).toContainText("gpu.example.com");
    await expect(slice.getByRole("cell", { name: "8", exact: true })).toBeVisible();
  });

  await test.step("ResourceClaims: allocated to a GPU on the worker, reserved for the pod", async () => {
    await page.goto("/r/resourceclaims");
    const claim = row("e2e-gpu");
    await expect(claim).toContainText("allocated,reserved");
    await expect(claim).toContainText("gpu.example.com");
    await expect(claim).toContainText(new RegExp(`${worker}/gpu-\\d`));
    await expect(claim).toContainText("e2e-gpu-pod");
  });

  await test.step("the pod's drawer links its claim, whose page shows the allocation", async () => {
    await page.goto("/workloads?pod=kubebay-dra/e2e-gpu-pod");
    const drawer = page.getByRole("dialog", { name: "e2e-gpu-pod" });
    await expect(drawer.getByText("Resource claims (1)")).toBeVisible();
    await drawer.getByText("e2e-gpu", { exact: true }).click();
    await expect(page).toHaveURL(/\/detail\/resourceclaims\/kubebay-dra\/e2e-gpu$/);
    await expect(page.getByText("Back to ResourceClaims")).toBeVisible();
    // The claim's Summary: the GPU it was given, and the pod it's reserved for.
    const section = (title: string) => page.locator(".pod-section").filter({ hasText: title });
    await expect(section("Allocated devices (1)")).toContainText(new RegExp(`${worker}/gpu-\\d`));
    await expect(section("Reserved for (1)").getByRole("link", { name: "e2e-gpu-pod" })).toBeVisible();
  });

  expect(pageErrors).toEqual([]);
});
