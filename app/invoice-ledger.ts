export const INVOICE_LEDGER_HEADERS = [
  "序号",
  "原文件名",
  "现文件名",
  "发票号码",
  "发票金额",
  "购买方名称",
  "购买方纳税号",
  "销售方名称",
  "销售方纳税号",
  "项目名称",
  "合计金额",
  "税额",
] as const;

export type InvoiceLedgerInput = {
  originalName: string;
  currentName: string;
  number: string;
  amount: string;
  buyerName?: string;
  buyerTaxId?: string;
  sellerName?: string;
  sellerTaxId?: string;
  itemName?: string;
  subtotal?: string;
  taxAmount?: string;
};

function amountCell(value?: string) {
  if (!value) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

export function buildInvoiceLedgerRows(items: InvoiceLedgerInput[]) {
  return items.map((item, index) => [
    index + 1,
    item.originalName,
    item.currentName,
    item.number,
    amountCell(item.amount),
    item.buyerName ?? "",
    item.buyerTaxId ?? "",
    item.sellerName ?? "",
    item.sellerTaxId ?? "",
    item.itemName ?? "",
    amountCell(item.subtotal),
    amountCell(item.taxAmount),
  ]);
}
