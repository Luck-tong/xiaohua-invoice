import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvoiceLedgerRows,
  INVOICE_LEDGER_HEADERS,
} from "../app/invoice-ledger.ts";

test("builds the exact twelve-column invoice ledger in the requested order", () => {
  assert.deepEqual([...INVOICE_LEDGER_HEADERS], [
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
