import { execFileSync } from "node:child_process";
import { expect, test, type Locator } from "@playwright/test";

// KB-11: the path every user walks, against a real cluster. The engine and the
// cluster are set up outside (see docs/E2E.md); fixtures/golden-path.yaml is the
// pod it drives.
const token = process.env.KUBEBAY_TOKEN ?? "e2e-token";
const kubeContext = process.env.KUBEBAY_E2E_CONTEXT ?? "kind-kubebay-e2e";
const namespace = "kubebay-e2e";
const pod = "e2e-logger";

/** The highest "tick N" the log view shows. */
async function lastTick(lines: Locator): Promise<number> {
  const texts = await lines.allTextContents();
  return Math.max(0, ...texts.map((t) => Number(/tick (\d+)/.exec(t)?.[1] ?? 0)));
}

test("connect → Pods → logs → exec → port-forward → YAML dry-run diff → apply", async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await test.step("connect with the session token and open the cluster", async () => {
    await page.goto("/");
    await page.getByLabel("session token").fill(token);
    await page.getByRole("button", { name: "Connect" }).click();
    // No cluster is active yet, so the app starts on the cluster list.
    await expect(page).toHaveURL(/\/clusters/);
    await page.getByRole("row").filter({ hasText: kubeContext }).first().click();
    await expect(page).toHaveURL(/\/workloads-overview/);
  });

  const drawer = page.getByRole("dialog", { name: pod });

  await test.step("open Pods and the pod", async () => {
    await page.getByRole("navigation").getByRole("link", { name: "Pods", exact: true }).click();
    await expect(page).toHaveURL(/\/workloads/);
    await page.getByRole("row").filter({ hasText: pod }).first().click();
    await expect(drawer).toBeVisible();
  });

  await test.step("logs stream", async () => {
    await drawer.getByRole("tab", { name: "Logs" }).click();
    const lines = drawer.locator(".log-line").filter({ hasText: /tick \d+/ });
    await expect(lines.first()).toBeVisible();
    // The pod logs once a second: a later line arriving proves it's a stream.
    const seen = await lastTick(lines);
    await expect.poll(() => lastTick(lines), { timeout: 20_000 }).toBeGreaterThan(seen);
  });

  await test.step("exec: an echo round-trips through a shell in the pod", async () => {
    await drawer.getByRole("tab", { name: "Terminal" }).click();
    const term = drawer.locator(".xterm");
    const rows = drawer.locator(".xterm-rows");
    // busybox has no bash: Kubebay falls back to sh, whose prompt ends in "#".
    await expect(rows).toContainText("#");
    await term.click();
    // The shell computes 42, so the output can't be the echoed keystrokes.
    await page.keyboard.type("echo kb-$((6*7))");
    await page.keyboard.press("Enter");
    await expect(rows).toContainText("kb-42");
  });

  await test.step("port-forward: the pod's page is reachable", async () => {
    await drawer.getByRole("tab", { name: "Summary" }).click();
    const opened = context.waitForEvent("page");
    await drawer.getByRole("button", { name: "Forward" }).click();
    const tab = await opened;
    await expect(tab.locator("body")).toContainText("kubebay-e2e-ok");
    await tab.close();
    await drawer.getByRole("button", { name: "Stop" }).click();
    await expect(drawer.getByRole("button", { name: "Forward" })).toBeVisible();
  });

  await test.step("YAML: edit, dry-run with a diff, apply", async () => {
    await drawer.getByRole("tab", { name: "YAML" }).click();
    const editor = drawer.locator(".yaml-wrap");
    const label = editor.locator(".view-line").filter({ hasText: /^\s*app:\se2e-logger\s*$/ });
    await label.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("e2e-edited: golden");

    await editor.getByRole("button", { name: "Dry-run" }).click();
    await expect(editor.getByText(/Dry-run passed/)).toBeVisible();
    // The server's preview, diffed against what's live: the new label is an inserted line.
    const diff = editor.locator(".monaco-diff-editor");
    await expect(diff).toBeVisible();
    await expect(diff.locator(".line-insert").first()).toBeVisible();

    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(editor.getByText(/Applied: patched 1 field/)).toBeVisible();
  });

  await test.step("the cluster stores the edit", async () => {
    const stored = execFileSync(
      "kubectl",
      ["--context", kubeContext, "-n", namespace, "get", "pod", pod, "-o", "jsonpath={.metadata.labels.e2e-edited}"],
      { encoding: "utf8" },
    );
    expect(stored).toBe("golden");
  });

  expect(pageErrors).toEqual([]);
});
