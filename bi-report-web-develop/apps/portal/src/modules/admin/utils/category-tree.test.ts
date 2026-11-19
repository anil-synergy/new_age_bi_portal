import { describe, expect, it } from "vitest";
import {
  buildCategoryLookup,
  categoryBreadcrumb,
  isCategoryDescendant,
  sortCategoriesDepthFirst,
  toTreeTagOptions,
} from "./category-tree";

const flat = [
  { id: "root", name: "Root", parentId: null, displayOrder: 0 },
  { id: "child", name: "Child", parentId: "root", displayOrder: 1 },
  { id: "leaf", name: "Leaf", parentId: "child", displayOrder: 0 },
];

describe("category-tree", () => {
  it("builds breadcrumbs root to leaf", () => {
    const lookup = buildCategoryLookup(flat);
    expect(categoryBreadcrumb(lookup, "leaf")).toBe("Root › Child › Leaf");
  });

  it("orders depth-first", () => {
    expect(sortCategoriesDepthFirst(flat).map((c) => c.id)).toEqual(["root", "child", "leaf"]);
  });

  it("detects descendants", () => {
    const lookup = buildCategoryLookup(flat);
    expect(isCategoryDescendant(lookup, "root", "leaf")).toBe(true);
    expect(isCategoryDescendant(lookup, "leaf", "root")).toBe(false);
  });

  it("indents tree tag options", () => {
    const options = toTreeTagOptions(flat);
    expect(options.find((o) => o.id === "leaf")?.name.startsWith("\u00a0\u00a0\u00a0\u00a0")).toBe(true);
  });
});