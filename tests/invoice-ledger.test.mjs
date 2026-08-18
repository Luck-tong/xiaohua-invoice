import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import JSZip from "jszip";

import {
  buildInvoiceLedgerRows,
  INVOICE_LEDGER_FIELDS,
  invoiceLedgerRowIncomplete,
} from "../app/invoice-ledger.ts";
import { styleInvoiceLedgerXlsx } from "../app/invoice-ledger-style.ts";

test("builds the exact twelve-column invoice ledger in the requested order", () => {
  assert.deepEqual(INVOICE_LEDGER_FIELDS.map((field) => field.label), [
    "序号", "原文件名", "现文件名", "发票号码", "发票金额", "购买方名称",
    "购买方纳税号", "销售方名称", "销售方纳税号", "项目名称", "合计金额", "税额",
  ]);

  assert.deepEqual(buildInvoiceLedgerRows([{
    originalName: "原发票.pdf",
    currentName: "26912000000461724376（770）.pdf",
    number: "26912000000461724376",
    amount: "770",
    buyerName: "上海市建纬律师事务所",
    buyerTaxId: "31310000425013819A",
    sellerName: "大连祖君宏正黄旗餐饮有限公司",
    sellerTaxId: "91210202MADFQLJ04K",
    itemName: "生产生活服务-餐饮服务",
    subtotal: "726.42",
    taxAmount: "43.58",
  }]), [[
    1,
    "原发票.pdf",
    "26912000000461724376（770）.pdf",
    "26912000000461724376",
    770,
    "上海市建纬律师事务所",
    "31310000425013819A",
    "大连祖君宏正黄旗餐饮有限公司",
    "91210202MADFQLJ04K",
    "生产生活服务-餐饮服务",
    726.42,
    43.58,
  ]]);
});

test("exports only checked fields while preserving their fixed order", () => {
  const rows = buildInvoiceLedgerRows([{
    originalName: "a.pdf",
    currentName: "b.pdf",
    number: "00123456789012345678",
    amount: "88.6",
  }], new Set(["amount", "index", "number"]));

  assert.deepEqual(rows, [[1, "00123456789012345678", 88.6]]);
});

test("marks payment screenshots with missing invoice details as incomplete", () => {
  assert.equal(invoiceLedgerRowIncomplete({
    originalName: "微信图片.jpg",
    currentName: "微信截图发票（20.62）.jpg",
    number: "",
    amount: "20.62",
  }), true);
});

test("keeps identifiers as text and unknown amounts blank", () => {
  const [row] = buildInvoiceLedgerRows([{
    originalName: "a.pdf",
    currentName: "b.pdf",
    number: "00123456789012345678",
    amount: "1",
    buyerTaxId: "000000000000001",
  }]);

  assert.equal(row[3], "00123456789012345678");
  assert.equal(row[6], "000000000000001");
  assert.equal(row[10], "");
  assert.equal(row[11], "");
});

test("writes a pale-blue header and a pale-red incomplete row into the xlsx file", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["序号", "发票号码"],
    [1, "11111111111111111111"],
    [2, ""],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "发票台账");
  const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const styled = await styleInvoiceLedgerXlsx(data, 2, 2, [false, true]);
  const zip = await JSZip.loadAsync(styled);
  const stylesXml = await zip.file("xl/styles.xml").async("string");
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");

  assert.match(stylesXml, /FFDCEBFA/);
  assert.match(stylesXml, /FFFDE7E7/);
  assert.match(sheetXml, /<c[^>]*r="A1"[^>]*s="\d+"/);
  assert.match(sheetXml, /<c[^>]*r="A3"[^>]*s="\d+"/);
});
