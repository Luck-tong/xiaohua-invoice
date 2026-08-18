type InvoiceReadinessInput = {
  number: string;
  amount: string;
  category: string;
};

export function isDownloadableInvoice(item: InvoiceReadinessInput) {
  return Boolean(
    item.amount && (item.number || item.category === "微信截图发票"),
  );
}

export function invoiceNamePrefix(item: InvoiceReadinessInput) {
  return item.number || (item.category === "微信截图发票" ? item.category : "");
}
