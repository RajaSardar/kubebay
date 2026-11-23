import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "../Markdown";

const md = (src: string) => render(<Markdown source={src} />);

describe("Markdown", () => {
  it("renders headings, paragraphs, emphasis, code and lists", () => {
    const { container } = md("# Redis\n\nRuns a **fast** cache with `redis-server`.\n\n- one\n- two\n\n1. first\n2. second\n\n```\nhelm install x\n```\n");
    expect(screen.getByRole("heading", { level: 1, name: "Redis" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("fast");
    expect(container.querySelector("p code")?.textContent).toBe("redis-server");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("helm install x");
  });

  it("never turns raw HTML into elements: it shows no script, handler or frame", () => {
    const { container } = md('<script>alert(1)</script>\n\nhello <img src="https://evil.example/x.png" onerror="alert(1)"> world\n\n<iframe src="https://evil.example"></iframe>');
    expect(container.querySelector("script, img, iframe, [onerror]")).toBeNull();
    expect(container.textContent).toContain("hello");
    expect(container.textContent).toContain("world");
  });

  it("links open safely and only for web and mail addresses", () => {
    const { container } = md("[docs](https://example.com/a) [mail](mailto:a@example.com) [bad](javascript:alert(1)) [data](data:text/html,x) [rel](./other.md)");
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/a", "mailto:a@example.com"]);
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.getAttribute("rel")).toContain("noreferrer");
    }
    expect(container.textContent).toContain("bad");
    expect(container.textContent).toContain("rel");
  });

  it("never loads an image: it shows the alt text instead", () => {
    const { container } = md("![build badge](https://img.shields.io/x.svg) text");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("build badge");
  });

  it("renders a GFM pipe table as a design-system table, with its alignment", () => {
    const { container } = md(
      [
        "Parameters:",
        "",
        "| Name | Description | Value |",
        "|:-----|:-----------:|------:|",
        "| `replicas` | How **many** pods | `1` |",
        "| image.tag | The tag, with a \\| pipe | latest |",
        "",
        "After.",
      ].join("\n"),
    );
    const table = screen.getByRole("table");
    expect(table).toHaveClass("kb-table");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Name", "Description", "Value"]);
    expect(headers.map((h) => h.style.textAlign)).toEqual(["left", "center", "right"]);
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const first = rows[0]!.querySelectorAll("td");
    expect(first[0]!.querySelector("code")?.textContent).toBe("replicas");
    expect(first[1]!.querySelector("strong")?.textContent).toBe("many");
    expect(first[2]!.style.textAlign).toBe("right");
    expect(rows[1]!.querySelectorAll("td")[1]!.textContent).toBe("The tag, with a | pipe");
    expect(container.textContent).toContain("Parameters:");
    expect(container.textContent).toContain("After.");
  });

  it("works without outer pipes, pads short rows and drops extra cells", () => {
    md("a | b\n--- | ---\n1\n2 | 3 | 4");
    const rows = screen.getByRole("table").querySelectorAll("tbody tr");
    expect(Array.from(rows[0]!.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["1", ""]);
    expect(Array.from(rows[1]!.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["2", "3"]);
  });

  it("ends a table at a blank line, and starts one right after a paragraph", () => {
    const { container } = md("Intro line\n| a | b |\n| - | - |\n| 1 | 2 |\n\nTail");
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("Intro line");
    expect(container.textContent).toContain("Tail");
  });

  it("is not a table when the delimiter row does not match the header", () => {
    const { container } = md("| a | b |\n| --- |\n| 1 | 2 |");
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("| a | b |");
  });

  it("keeps table cells as text: no HTML, no unsafe links", () => {
    const { container } = md('| x |\n| - |\n| <img src="https://evil.example/x.png" onerror="alert(1)"> [bad](javascript:alert(1)) [ok](https://example.com) |');
    expect(container.querySelector("img, script, [onerror]")).toBeNull();
    expect(Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["https://example.com"]);
  });

  it("does not hang or throw on odd input", () => {
    expect(() => md("**unclosed `code [link](")).not.toThrow();
    expect(() => md("")).not.toThrow();
  });
});
