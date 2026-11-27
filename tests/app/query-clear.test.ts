import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QueryCombobox from "@/app/components/QueryCombobox";

const render = (value: string) =>
  renderToStaticMarkup(
    h(QueryCombobox, { value, onChange: () => {}, onSubmit: () => {}, loading: false, invalid: false, describedBy: "q-hint" }),
  );

describe("search box one-click clear", () => {
  it("shows a labelled clear button when there is text", () => {
    const html = render("airpods 4");
    expect(html).toContain('class="combo__clear"');
    expect(html).toContain('aria-label="Clear search text"');
    expect(html).toContain('type="button"');
  });

  it("hides the clear button when the box is empty", () => {
    expect(render("")).not.toContain("combo__clear");
  });
});
