import type { CategoryPathItem, PortalReport } from "@/types";

const MAX_DEPTH = 32;

export interface MenuNode {
  key: string;
  name: string;
  displayOrder: number;
  children: MenuNode[];
  reports: PortalReport[];
}

/**
 * Root-first chain for a category, following parent links. A missing parent ends the chain
 * (the category becomes a root); a cycle stops at the first repeated id.
 */
export function buildCategoryPath(
  categories: ReadonlyMap<string, CategoryPathItem>,
  categoryId: string | null | undefined
): CategoryPathItem[] | undefined {
  let current = categoryId ? categories.get(categoryId) : undefined;
  if (!current) return undefined;
  const path: CategoryPathItem[] = [];
  const seen = new Set<string>();
  while (current && !seen.has(current.id) && path.length < MAX_DEPTH) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? categories.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/** True only when at least one report sits below a parent category; otherwise the flat menu is used. */
export function hasCategoryHierarchy(reports: PortalReport[]): boolean {
  return reports.some((r) => (r.categoryPath?.length ?? 0) > 1);
}

/**
 * Builds the Parent → Child → Subchild menu from each report's category path.
 * Reports without a path are grouped by category name at the root, matching the flat menu.
 * Duplicate category ids keep their first parent; links that would form a cycle become roots.
 */
export function buildMenuTree(reports: PortalReport[]): MenuNode[] {
  const nodes = new Map<string, { node: MenuNode; parentKey?: string }>();

  const ensure = (key: string, name: string, displayOrder: number, parentKey?: string) => {
    let entry = nodes.get(key);
    if (!entry) {
      entry = { node: { key, name, displayOrder, children: [], reports: [] }, parentKey };
      nodes.set(key, entry);
    }
    return entry.node;
  };

  for (const report of reports) {
    let leaf: MenuNode | undefined;
    let parentKey: string | undefined;
    for (const item of report.categoryPath ?? []) {
      const key = `id:${item.id.toLowerCase()}`;
      leaf = ensure(key, item.name, item.displayOrder ?? 0, parentKey);
      parentKey = key;
    }
    if (!leaf) {
      const name = report.categoryName || "Reports";
      leaf = ensure(`name:${name}`, name, 0);
    }
    if (!leaf.reports.some((r) => r.id === report.id)) leaf.reports.push(report);
  }

  const createsCycle = (key: string, parentKey: string) => {
    const seen = new Set<string>();
    let cursor: string | undefined = parentKey;
    while (cursor && !seen.has(cursor)) {
      if (cursor === key) return true;
      seen.add(cursor);
      cursor = nodes.get(cursor)?.parentKey;
    }
    return false;
  };

  const roots: MenuNode[] = [];
  for (const [key, { node, parentKey }] of Array.from(nodes)) {
    const parent = parentKey ? nodes.get(parentKey) : undefined;
    if (parent && !createsCycle(key, parentKey!)) parent.node.children.push(node);
    else roots.push(node);
  }

  const sortTree = (list: MenuNode[]) => {
    list.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    list.forEach((n) => sortTree(n.children));
    return list;
  };
  return sortTree(roots);
}

/** Keys of every category above (and including) the one holding the report. */
export function ancestorKeysOfReport(roots: MenuNode[], reportId: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!reportId) return keys;
  const visit = (node: MenuNode, trail: string[]): boolean => {
    const next = [...trail, node.key];
    if (node.reports.some((r) => r.id === reportId)) {
      next.forEach((k) => keys.add(k));
      return true;
    }
    return node.children.some((child) => visit(child, next));
  };
  roots.some((root) => visit(root, []));
  return keys;
}
