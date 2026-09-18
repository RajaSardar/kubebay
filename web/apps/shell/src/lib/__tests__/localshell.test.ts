import { describe, expect, it } from "vitest";
import { classifyShellEnd, describeExit, looksProduction } from "../localshell";

describe("looksProduction", () => {
  it("matches production-ish words as whole tokens", () => {
    expect(looksProduction("prod-eu-1")).toBe(true);
    expect(looksProduction("acme_production")).toBe(true);
    expect(looksProduction("", "gke_acme_us-east1_prd")).toBe(true);
    expect(looksProduction("live-cluster")).toBe(true);
    expect(looksProduction("prod2")).toBe(true);
  });

  it("does not match words that merely contain them", () => {
    expect(looksProduction("reproduction-lab")).toBe(false);
    expect(looksProduction("deliverance")).toBe(false);
    expect(looksProduction("staging")).toBe(false);
    expect(looksProduction("kind-dev")).toBe(false);
  });

  it("ignores missing names", () => {
    expect(looksProduction(undefined, undefined)).toBe(false);
  });
});

describe("classifyShellEnd", () => {
  it("reads the exit code the engine sends", () => {
    expect(classifyShellEnd("exit code 0")).toEqual({ kind: "exit", code: 0 });
    expect(classifyShellEnd("exit code 137")).toEqual({ kind: "exit", code: 137 });
    expect(classifyShellEnd("exit code -1")).toEqual({ kind: "exit", code: -1 });
  });

  it("separates a missing feature from a dead shell", () => {
    const stub = classifyShellEnd("local shell is not built into this binary");
    expect(stub.kind).toBe("unsupported");
    expect(classifyShellEnd("local shell is not enabled").kind).toBe("unsupported");
    expect(classifyShellEnd("no usable shell found").kind).toBe("error");
  });

  it("never leaves the user with an empty explanation", () => {
    expect(classifyShellEnd(undefined)).toEqual({
      kind: "error",
      detail: "the session ended unexpectedly",
    });
  });
});

describe("describeExit", () => {
  it("names signals rather than showing 128+n", () => {
    expect(describeExit(137)).toBe("terminated by signal 9");
    expect(describeExit(130)).toBe("terminated by signal 2");
    expect(describeExit(0)).toBe("exit 0");
    expect(describeExit(1)).toBe("exit 1");
    expect(describeExit(-1)).toBe("ended without an exit code");
  });
});
