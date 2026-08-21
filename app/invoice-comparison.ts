export type ComparableInvoice = {
  id: string;
  number: string;
  amount: string;
  category: string;
  sellerName?: string;
  itemName?: string;
};

export type ComparisonCategory = {
  category: string;
  leftCount: number;
  leftAmount: number;
  rightCount: number;
  rightAmount: number;
};

export type ComparisonDuplicateGroup = {
  key: string;
  number: string;
  amount: string;
  leftIds: string[];
  rightIds: string[];
};

function amountOf(item: ComparableInvoice) {
  const value = Number(item.amount);
  return Number.isFinite(value) ? value : 0;
}

export function comparisonDuplicateKey(item: ComparableInvoice) {
  if (!item.number || !item.amount) return "";
  const amount = amountOf(item);
  return Number.isFinite(amount) ? `${item.number}::${amount.toFixed(2)}` : "";
}

export function compareInvoiceBatches(
  left: ComparableInvoice[],
  right: ComparableInvoice[],
) {
  const categoryMap = new Map<string, ComparisonCategory>();
  const addCategory = (item: ComparableInvoice, side: "left" | "right") => {
    const category = item.category || "未分类";
    const summary = categoryMap.get(category) ?? {
      category,
      leftCount: 0,
      leftAmount: 0,
      rightCount: 0,
      rightAmount: 0,
    };
    if (side === "left") {
      summary.leftCount += 1;
      summary.leftAmount += amountOf(item);
    } else {
      summary.rightCount += 1;
      summary.rightAmount += amountOf(item);
    }
    categoryMap.set(category, summary);
  };
  left.forEach((item) => addCategory(item, "left"));
  right.forEach((item) => addCategory(item, "right"));

  const duplicateMap = new Map<string, ComparisonDuplicateGroup>();
  const addDuplicate = (item: ComparableInvoice, side: "left" | "right") => {
    const key = comparisonDuplicateKey(item);
    if (!key) return;
    const group = duplicateMap.get(key) ?? {
      key,
      number: item.number,
      amount: item.amount,
      leftIds: [],
      rightIds: [],
    };
    group[side === "left" ? "leftIds" : "rightIds"].push(item.id);
    duplicateMap.set(key, group);
  };
  left.forEach((item) => addDuplicate(item, "left"));
  right.forEach((item) => addDuplicate(item, "right"));

  return {
    categories: [...categoryMap.values()].sort((a, b) =>
      a.category.localeCompare(b.category, "zh-CN"),
    ),
    duplicateGroups: [...duplicateMap.values()].filter(
      (group) => group.leftIds.length + group.rightIds.length > 1,
    ),
  };
}
