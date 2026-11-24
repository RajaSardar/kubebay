// A pod's name in a table is split across spans (its generated end is set apart),
// so getByText("web-1") cannot find it. This matches the span holding the whole name.
export const podNameText = (name: string) => (_: string, el: Element | null) =>
  !!el && el.tagName === "SPAN" && el.textContent === name && !!el.parentElement?.classList.contains("td-name");
