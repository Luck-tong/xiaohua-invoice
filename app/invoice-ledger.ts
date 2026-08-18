export const INVOICE_LEDGER_FIELDS = [
  { key: "index", label: "序号", width: 8 },
  { key: "originalName", label: "原文件名", width: 42 },
  { key: "currentName", label: "现文件名", width: 42 },
  { key: "number", label: "发票号码", width: 24 },
  { key: "amount", label: "发票金额", width: 14 },
  { key: "buyerName", label: "购买方名称", width: 30 },
  { key: "buyerTaxId", label: "购买方纳税号", width: 24 },
  { key: "sellerName", label: "销售方名称", width: 30 },
  { key: "sellerTaxId", label: "销售方纳税号", width: 24 },
  { key: "itemName", label: "项目名称", width: 34 },
  { key: "subtotal", label: "合计金额", width: 14 },
  { key: "taxAmount", label: "税额", width: 14 },
] as const;

export type InvoiceLedgerFieldKey = typeof INVOICE_LEDGER_FIELDS[number]["key"];

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

function fieldValue(item: InvoiceLedgerInput, index: number, key: InvoiceLedgerFieldKey) {
  if (key === "index") return index + 1;
  if (key === "amount" || key === "subtotal" || key === "taxAmount") {
    return amountCell(item[key]);
  }
  return item[key] ?? "";
}

export function invoiceLedgerSelection(selectedKeys: Iterable<InvoiceLedgerFieldKey>) {
  const selected = new Set(selectedKeys);
  return INVOICE_LEDGER_FIELDS.filter((field) => selected.has(field.key));
}

export function buildInvoiceLedgerRows(
  items: InvoiceLedgerInput[],
  selectedKeys: Iterable<InvoiceLedgerFieldKey> = INVOICE_LEDGER_FIELDS.map((field) => field.key),
) {
  const fields = invoiceLedgerSelection(selectedKeys);
  return items.map((item, index) =>
    fields.map((field) => fieldValue(item, index, field.key))
  );
}

export function invoiceLedgerRowIncomplete(item: InvoiceLedgerInput) {
  return [
    item.number,
    item.amount,
    item.buyerName,
    item.buyerTaxId,
    item.sellerName,
    item.sellerTaxId,
    item.itemName,
    item.subtotal,
    item.taxAmount,
  ].some((value) => value === undefined || value === "");
}
