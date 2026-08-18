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

function isPaymentScreenshot(category: string) {
  return category === "微信截图发票" || category === "支付宝图片";
}
