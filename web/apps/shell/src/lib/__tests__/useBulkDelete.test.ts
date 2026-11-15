import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBulkDelete } from "../useBulkDelete";
import { PolicyRejectionError } from "../policyRejection";

describe("useBulkDelete", () => {
  it("reports a plain aggregate message when a single delete fails with an ordinary error", async () => {
    const { result } = renderHook(() => useBulkDelete(() => Promise.reject(new Error("connection refused"))));
    act(() => result.current.request([{ ns: "default", name: "pod-1" }]));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.error).toContain("connection refused");
    expect(result.current.rejection).toBeNull();
  });

  it("exposes structured rejection detail when a single delete is policy-rejected (backlog #17)", async () => {
    const rejection = { engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "resource is protected" };
    const { result } = renderHook(() => useBulkDelete(() => Promise.reject(new PolicyRejectionError(rejection))));
    act(() => result.current.request([{ ns: "default", name: "pod-1" }]));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.rejection).toEqual(rejection);
  });

  it("falls back to the aggregate string for a bulk (multi-target) failure even if one is policy-rejected", async () => {
    const rejection = { engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "resource is protected" };
    let call = 0;
    const { result } = renderHook(() =>
      useBulkDelete(() => {
        call++;
        return call === 1 ? Promise.reject(new PolicyRejectionError(rejection)) : Promise.resolve();
      }),
    );
    act(() => result.current.request([{ ns: "default", name: "pod-1" }, { ns: "default", name: "pod-2" }]));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.rejection).toBeNull();
    expect(result.current.error).toContain("1 of 2 deleted");
  });

  it("clears the rejection when a new request/confirm cycle starts", async () => {
    const rejection = { engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "resource is protected" };
    let shouldReject = true;
    const { result } = renderHook(() =>
      useBulkDelete(() => (shouldReject ? Promise.reject(new PolicyRejectionError(rejection)) : Promise.resolve())),
    );
    act(() => result.current.request([{ ns: "default", name: "pod-1" }]));
    await act(async () => {
      await result.current.confirm();
    });
    expect(result.current.rejection).not.toBeNull();

    shouldReject = false;
    act(() => result.current.request([{ ns: "default", name: "pod-1" }]));
    expect(result.current.rejection).toBeNull();
  });
});
