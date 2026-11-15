/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fmtBytes, fmtCpu } from "../format";

describe("fmtCpu", () => {
  it("shows millicores below a core and cores from one up", () => {
    expect(fmtCpu(0.2)).toBe("1m");
    expect(fmtCpu(240)).toBe("240m");
    expect(fmtCpu(1500)).toBe("1.50 core");
  });
});

describe("fmtBytes", () => {
  it("uses binary units with one decimal below 100", () => {
    expect(fmtBytes(0)).toBe("0");
    expect(fmtBytes(512)).toBe("512B");
    expect(fmtBytes(40 * 1024 * 1024)).toBe("40.0Mi");
    expect(fmtBytes(270 * 1024 * 1024)).toBe("270Mi");
    expect(fmtBytes(3 * 1024 ** 3)).toBe("3.0Gi");
  });
});

describe("shared formatters live in lib, not in a page", () => {
  it("the resource table does not import from the Pods page", () => {
    const src = readFileSync(resolve(__dirname, "../../pages/ResourceTable.tsx"), "utf8");
    expect(src).not.toMatch(/from "\.\/Workloads"/);
  });
});
