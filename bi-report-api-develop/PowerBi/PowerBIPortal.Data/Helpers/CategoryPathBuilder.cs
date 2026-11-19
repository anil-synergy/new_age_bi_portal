using PowerBIPortal.Core.Models.Dto;

namespace PowerBIPortal.Data.Helpers
{
    public static class CategoryPathBuilder
    {
        private const int MaxDepth = 32;

        /// <summary>
        /// Walks parent links from the category up to its root and returns the chain root-first.
        /// A missing or inactive parent ends the chain, so that category is treated as a root.
        /// Cycles stop at the first repeated category. Returns null when the category itself is unknown.
        /// </summary>
        public static List<CategoryPathItem> Build(IReadOnlyDictionary<Guid, CategoryPathItem> categories, Guid categoryId)
        {
            if (categories == null || !categories.TryGetValue(categoryId, out var current)) return null;

            var path = new List<CategoryPathItem>();
            var seen = new HashSet<Guid>();
            while (current != null && seen.Add(current.Id) && path.Count < MaxDepth)
            {
                path.Add(current);
                current = current.ParentId is Guid parentId && categories.TryGetValue(parentId, out var parent) ? parent : null;
            }
            path.Reverse();
            return path;
        }
    }
}
