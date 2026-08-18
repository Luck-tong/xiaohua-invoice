import assert from "node:assert/strict";
import test from "node:test";

import {
  completedInvoiceFilterCategory,
  invoiceNamePrefix,
  isDownloadableInvoice,
} from "../app/invoice-readiness.ts";

test("accepts a WeChat screenshot with an amount and no invoice number", () => {
  const item = { number: "", amount: "70613.50", category: "微信截图发票" };

  assert.equal(isDownloadableInvoice(item), true);
  assert.equal(invoiceNamePrefix(item), "微信截图发票");
});

test("still requires an invoice number for ordinary invoices", () => {
  const item = { number: "", amount: "218.00", category: "餐饮费" };

  assert.equal(isDownloadableInvoice(item), false);
  assert.equal(invoiceNamePrefix(item), "");
});

test("still requires an amount for WeChat screenshots", () => {
  assert.equal(
    isDownloadableInvoice({ number: "", amount: "", category: "微信截图发票" }),
    false,
  );
});

test("accepts an Alipay screenshot with an amount and no invoice number", () => {
  const item = { number: "", amount: "20.62", category: "支付宝图片" };

  assert.equal(isDownloadableInvoice(item), true);
  assert.equal(invoiceNamePrefix(item), "支付宝图片");
});

test("groups completed payment screenshots without invoice numbers as other sources", () => {
  const payment = { number: "", amount: "70613.50", category: "微信截图发票" };
  const invoice = { number: "26312000004897976641", amount: "218", category: "微信截图发票" };

  assert.equal(completedInvoiceFilterCategory(payment), "其他来源发票");
  assert.equal(completedInvoiceFilterCategory(invoice), "微信截图发票");
});
