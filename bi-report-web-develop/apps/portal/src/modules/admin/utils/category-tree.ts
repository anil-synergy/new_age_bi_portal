import type { TagOption } from "../components/AdminChrome";

export type FlatCategory = {
  id: string;
  name: string;
  parentId?: string | null;
  displayOrder?: number;
};

const MAX_DEPTH = 32;

export function buildCategoryLookup(categories: FlatCategory[]): Map<string, FlatCategory> {
  return new Map(categories.map((c) => [c.id, c]));
}

export function categoryBreadcrumb(lookup: Map<string, FlatCategory>, id: string | undefined): string {
  if (!id || !lookup.has(id)) return "";
  const parts: string[] = [];
  let cur: string | undefined = id;
  const seen = new Set<string>();
  while (cur && lookup.has(cur) && !seen.has(cur) && parts.length < MAX_DEPTH) {
    seen.add(cur);
    const node = lookup.get(cur)!;
    parts.push(node.name);
    cur = node.parentId ?? undefined;
  }
  return parts.reverse().join(" › ");
}

export function getCategoryDepth(lookup: Map<string, FlatCategory>, id: string): number {
  let depth = 0;
  let cur = lookup.get(id)?.parentId;
  const seen = new Set<string>();
  while (cur && lookup.has(cur) && !seen.has(cur) && depth < MAX_DEPTH) {
    seen.add(cur);
    depth++;
    cur = lookup.get(cur)?.parentId;
  }
  return depth;
}

export function isCategoryDescendant(
  lookup: Map<string, FlatCategory>,
  ancestorId: string,
  nodeId: string,
): boolean {
  let cur: string | undefined = nodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = lookup.get(cur)?.parentId ?? undefined;
  }
  return false;
}

/** Depth-first sibling order (display_order, then name). Orphans append at the end. */
export function sortCategoriesDepthFirst(categories: FlatCategory[]): FlatCategory[] {
  const byParent = new Map<string | null, FlatCategory[]>();
  for (const c of categories) {
    const parentKey = c.parentId?.trim() ? c.parentId : null;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey)!.push(c);
  }
  for (const list of byParent.values()) {
    list.sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name),
    );
  }
  const out: FlatCategory[] = [];
  const walk = (parentId: string | null) => {
    for (const child of byParent.get(parentId) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(null);
  const seen = new Set(out.map((c) => c.id));
  for (const c of categories) {
    if (!seen.has(c.id)) out.push(c);
  }
  return out;
}

export function toTreeTagOptions(categories: FlatCategory[], excludeIds: string[] = []): TagOption[] {
  const lookup = buildCategoryLookup(categories);
  const exclude = new Set(excludeIds);
  return sortCategoriesDepthFirst(categories)
    .filter((c) => !exclude.has(c.id))
    .map((c) => {
      const depth = getCategoryDepth(lookup, c.id);
      const path = categoryBreadcrumb(lookup, c.id);
      return {
        id: c.id,
        name: `${"\u00a0".repeat(depth * 2)}${c.name}`,
        hint: path !== c.name ? path : undefined,
      };
    });
}