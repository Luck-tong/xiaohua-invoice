export function filterFilesByCategories<T extends { category: string }>(
  files: T[],
  categories: Set<string>,
) {
  return files.filter((item) => categories.has(item.category));
}

export const DUPLICATE_DOWNLOAD_GROUP = "__duplicate_invoices__";

export function filterFilesByDownloadGroups<
  T extends { id: string; category: string },
>(files: T[], groups: Set<string>, duplicateIds: Set<string>) {
  return files.filter((item) =>
    duplicateIds.has(item.id)
      ? groups.has(DUPLICATE_DOWNLOAD_GROUP)
      : groups.has(item.category)
  );
}
