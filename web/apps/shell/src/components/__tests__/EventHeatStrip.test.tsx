import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventHeatStrip } from "../EventHeatStrip";

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("EventHeatStrip", () => {
  it("renders 30 bars and an hour-scale accessible label for no events", () => {
    const { container } = render(<EventHeatStrip events={[]} now={NOW} />);
    expect(container.querySelectorAll(".heat-strip-bar")).toHaveLength(30);
    expect(screen.getByRole("img", { name: /hour/i })).toBeTruthy();
  });

  it("gives the bucket containing an event a hover tooltip naming it a warning", () => {
    const { container } = render(<EventHeatStrip events={[{ ts: NOW - 1000, count: 3 }]} now={NOW} />);
    const withTitle = Array.from(container.querySelectorAll(".heat-strip-bar")).filter((el) => el.getAttribute("title"));
    expect(withTitle).toHaveLength(1);
    expect(withTitle[0]!.getAttribute("title")).toMatch(/warning/i);
  });

  it("labels the axis honestly as the last hour, not 24h", () => {
    render(<EventHeatStrip events={[]} now={NOW} />);
    expect(screen.getByText(/1h ago/i)).toBeTruthy();
    expect(screen.getByText(/now/i)).toBeTruthy();
  });

  it("shows no tooltip on an empty bucket", () => {
    const { container } = render(<EventHeatStrip events={[{ ts: NOW - HOUR + 1000, count: 1 }]} now={NOW} />);
    const bars = Array.from(container.querySelectorAll(".heat-strip-bar"));
    const empty = bars.filter((el) => !el.getAttribute("title"));
    expect(empty.length).toBe(29);
  });
});
