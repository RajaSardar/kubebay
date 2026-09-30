import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ControlTags } from "../ControlTags";

describe("ControlTags", () => {
  it("renders one tag per control, named in its tooltip", () => {
    render(
      <ControlTags
        controls={[
          { framework: "CIS", id: "5.4.1", name: "Prefer using Secrets as files over Secrets as environment variables" },
          { framework: "ATT&CK", id: "T1528", name: "Steal Application Access Token" },
        ]}
      />,
    );
    expect(screen.getByText("CIS 5.4.1")).toHaveAttribute("title", expect.stringContaining("environment variables"));
    expect(screen.getByText("ATT&CK T1528")).toHaveAttribute("title", expect.stringContaining("Steal Application Access Token"));
  });

  it("renders nothing for an untagged finding", () => {
    const { container } = render(<ControlTags controls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
