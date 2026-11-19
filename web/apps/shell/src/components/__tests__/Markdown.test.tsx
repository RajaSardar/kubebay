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

  it("does not hang or throw on odd input", () => {
    expect(() => md("**unclosed `code [link](")).not.toThrow();
    expect(() => md("")).not.toThrow();
  });
});
