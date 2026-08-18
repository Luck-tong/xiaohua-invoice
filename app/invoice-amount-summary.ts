type AmountItem = {
  id: string;
  category: string;
  amount: string;
};

export function summarizeInvoiceAmounts<T extends AmountItem>(items: T[]) {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  });

  const categories = [...groups]
    .map(([category, categoryItems]) => ({
      category,
      items: categoryItems,
      total: categoryItems.reduce(
        (sum, item) => sum + (Number(item.amount) || 0),
        0,
      ),
    }))
    .sort((left, right) => left.category.localeCompare(right.category, "zh-CN"));
  const ranked = [...items].sort(
    (left, right) => (Number(right.amount) || 0) - (Number(left.amount) || 0),
  );

  return {
    categories,
    highest: ranked.slice(0, 5),
    lowest: ranked.slice(-5).reverse(),
  };
}
