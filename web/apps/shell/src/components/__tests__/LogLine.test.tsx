import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LogLine } from "../LogLine";

describe("LogLine", () => {
  it("is classed by its level", () => {
    const { container } = render(<LogLine line="2026-11-09 [ERROR] payment failed" />);
    expect(container.firstChild).toHaveClass("log-line", "log-error");
    expect(container.firstChild).toHaveTextContent("2026-11-09 [ERROR] payment failed");
  });

  it("shows the app's own colours as theme colours, with the escape codes gone", () => {
    const { container } = render(<LogLine line={"\x1b[32mready\x1b[0m on :8080"} />);
    const run = container.querySelector(".ansi-green");
    expect(run).toHaveTextContent("ready");
    expect(container.firstChild).toHaveTextContent(/^ready on :8080$/);
  });

  it("is a plain line when there is nothing to go on", () => {
    const { container } = render(<LogLine line="GET /healthz 200" />);
    expect(container.firstChild).toHaveAttribute("class", "log-line");
  });
});
