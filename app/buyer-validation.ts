export type BuyerProfile = {
  name: string;
  taxId: string;
};

export type BuyerInvoiceFields = {
  buyerName?: string;
  buyerTaxId?: string;
  category?: string;
};

export const EMPTY_BUYER_PROFILE: BuyerProfile = { name: "", taxId: "" };

function compact(value = "") {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function validBuyerTaxId(value = "") {
  const normalized = compact(value);
  return /^\d{15}$/.test(normalized) || /^[0-9ABCDEFGHJKLMNPQRTUWXY]{18}$/.test(normalized);
}

export function buyerValidationIssues(
  item: BuyerInvoiceFields,
  profile: BuyerProfile,
) {
  if (["微信截图发票", "支付宝图片"].includes(item.category ?? "")) return [];

  const issues: string[] = [];
  const buyerName = compact(item.buyerName);
  const buyerTaxId = compact(item.buyerTaxId);
  const expectedName = compact(profile.name);
  const expectedTaxId = compact(profile.taxId);

  if (!buyerName) issues.push("缺少购买方名称");
  if (!buyerTaxId) issues.push("缺少购买方税号");
  else if (!validBuyerTaxId(buyerTaxId)) issues.push(`购买方税号格式异常（识别为${buyerTaxId.length}位）`);
  if (expectedName && buyerName && buyerName !== expectedName) {
    issues.push("购买方名称与常用档案不一致");
  }
  if (expectedTaxId && buyerTaxId && buyerTaxId !== expectedTaxId) {
    issues.push("购买方税号与常用档案不一致");
  }
  return issues;
}
