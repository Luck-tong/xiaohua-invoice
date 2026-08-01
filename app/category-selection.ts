export function filterFilesByCategories<T extends { category: string }>(
  files: T[],
  categories: Set<string>,
) {
  return files.filter((item) => categories.has(item.category));
}
