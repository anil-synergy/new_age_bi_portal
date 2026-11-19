export const filterMenuTree = (categories, searchTerm) => {
  const lower = searchTerm.trim().toLowerCase();
  if (!lower) {
    return categories || [];
  }

  return (categories || []).reduce((acc, category) => {
    const categoryMatches = category.categoryName?.toLowerCase().includes(lower);

    if (categoryMatches) {
      acc.push({ ...category });
      return acc;
    }

    const matchingReports = (category.reports || []).filter(
      (report) => report.title?.toLowerCase().includes(lower)
    );
    const matchingChildren = filterMenuTree(category.children, searchTerm);

    if (matchingReports.length > 0 || matchingChildren.length > 0) {
      acc.push({
        ...category,
        reports: matchingReports,
        children: matchingChildren
      });
    }

    return acc;
  }, []);
};

export const filterStarredReports = (reports, searchTerm) => {
  const lower = searchTerm.trim().toLowerCase();
  if (!lower) {
    return reports;
  }
  return reports.filter((report) => report.title?.toLowerCase().includes(lower));
};
