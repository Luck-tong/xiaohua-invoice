type InvoiceReadinessInput = {
  number: string;
  amount: string;
  category: string;
};

export function isDownloadableInvoice(item: InvoiceReadinessInput) {
  return Boolean(
    item.amount && (item.number || isPaymentScreenshot(item.category)),
  );
}

export function invoiceNamePrefix(item: InvoiceReadinessInput) {
  return item.number || (isPaymentScreenshot(item.category) ? item.category : "");
}

export function completedInvoiceFilterCategory(item: InvoiceReadinessInput) {
  return isDownloadableInvoice(item) && !item.number
    ? "其他来源发票"
    : item.category;
}

function isPaymentScreenshot(category: string) {
  return category === "微信截图发票" || category === "支付宝图片";
}
