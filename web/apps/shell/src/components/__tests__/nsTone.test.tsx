import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NsPill, NsSwatch, nsTone, NS_TONES } from "@kubebay/ui";

describe("namespace colour (backlog 63)", () => {
  it("gives a name the same tone every time, from 1 to the palette size", () => {
    for (const n of ["default", "kube-system", "shop", "payments-prod"]) {
      expect(nsTone(n)).toBe(nsTone(n));
      expect(nsTone(n)).toBeGreaterThanOrEqual(1);
      expect(nsTone(n)).toBeLessThanOrEqual(NS_TONES);
    }
  });

  it("spreads a realistic set of names over several tones, not one", () => {
    const names = ["default", "kube-system", "kube-public", "monitoring", "ingress-nginx", "cert-manager", "shop", "payments", "argocd", "logging"];
    expect(new Set(names.map(nsTone)).size).toBeGreaterThanOrEqual(4);
  });

  it("colours a namespace pill and keeps the name as its text", () => {
    render(<NsPill>shop</NsPill>);
    const pill = screen.getByText("shop");
    expect(pill).toHaveAttribute("data-ns-tone", String(nsTone("shop")));
  });

  it("leaves a pill that holds something other than a name uncoloured", () => {
    render(<NsPill>{["a", "b"]}</NsPill>);
    expect(document.querySelector(".ns-pill")).not.toHaveAttribute("data-ns-tone");
  });

  it("has a swatch that is decoration only, never the sole carrier of the name", () => {
    const { container } = render(<NsSwatch name="shop" />);
    const s = container.firstElementChild!;
    expect(s).toHaveAttribute("aria-hidden", "true");
    expect(s).toHaveAttribute("data-ns-tone", String(nsTone("shop")));
    expect(s.textContent).toBe("");
  });
});
