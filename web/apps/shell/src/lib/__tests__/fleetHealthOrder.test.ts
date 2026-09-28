import { describe, it, expect } from "vitest";
import { sortClustersByHealth } from "../fleetHealthOrder";

describe("sortClustersByHealth", () => {
  it("sorts the most unhealthy cluster first", () => {
    const order = sortClustersByHealth([
      { cluster: "a", unhealthy: 1 },
      { cluster: "b", unhealthy: 5 },
      { cluster: "c", unhealthy: 3 },
    ]);
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by cluster name for a stable order", () => {
    const order = sortClustersByHealth([
      { cluster: "z", unhealthy: 2 },
      { cluster: "a", unhealthy: 2 },
    ]);
    expect(order).toEqual(["a", "z"]);
  });

  it("returns an empty order for an empty fleet", () => {
    expect(sortClustersByHealth([])).toEqual([]);
  });
});
