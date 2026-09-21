import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClusterIconPicker, autoAvatar } from "../ClusterIconPicker";
import type { ClusterIcon } from "../../lib/useClusterIcons";

const baseIcon: ClusterIcon = { bg: "#F90", label: "AWS" };

function renderPicker(current: ClusterIcon = baseIcon, onSave = vi.fn(), onReset = vi.fn(), onClose = vi.fn()) {
  return render(
    <ClusterIconPicker
      clusterId="arn-aws-eks-us-east-1-123-cluster-prod"
      current={current}
      onSave={onSave}
      onReset={onReset}
      onClose={onClose}
    />
  );
}

describe("ClusterIconPicker – image tab", () => {
  it("shows Image tab alongside Colors tab", () => {
    renderPicker();
    expect(screen.getByRole("tab", { name: /image/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /color/i })).toBeTruthy();
  });

  it("URL input in Image tab calls onSave with imageUrl set", () => {
    const onSave = vi.fn();
    renderPicker(baseIcon, onSave);
    fireEvent.click(screen.getByRole("tab", { name: /image/i }));
    const input = screen.getByPlaceholderText(/https:\/\//i);
    fireEvent.change(input, { target: { value: "https://example.com/icon.png" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://example.com/icon.png" })
    );
  });

  it("clearing the URL removes imageUrl from saved icon", () => {
    const onSave = vi.fn();
    const iconWithImage: ClusterIcon = { bg: "#F90", label: "AWS", imageUrl: "https://example.com/icon.png" };
    renderPicker(iconWithImage, onSave);
    fireEvent.click(screen.getByRole("tab", { name: /image/i }));
    const input = screen.getByPlaceholderText(/https:\/\//i);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    const saved = onSave.mock.calls[0][0] as ClusterIcon;
    expect(saved.imageUrl).toBeFalsy();
  });

  it("shows existing imageUrl in input when icon already has one", () => {
    const iconWithImage: ClusterIcon = { bg: "#F90", label: "AWS", imageUrl: "https://example.com/icon.png" };
    renderPicker(iconWithImage);
    fireEvent.click(screen.getByRole("tab", { name: /image/i }));
    const input = screen.getByPlaceholderText(/https:\/\//i) as HTMLInputElement;
    expect(input.value).toBe("https://example.com/icon.png");
  });
});

describe("autoAvatar – sanitized IDs", () => {
  it("detects AWS from sanitized EKS id (dashes not colons)", () => {
    const a = autoAvatar("arn-aws-eks-us-east-1-123-cluster-prod");
    expect(a.label).toBe("AWS");
    expect(a.bg).toBe("#F90");
  });

  it("detects OrbStack", () => {
    const a = autoAvatar("orbstack");
    expect(a.label).toBe("ORB");
  });
});
