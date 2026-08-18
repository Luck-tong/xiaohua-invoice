import assert from "node:assert/strict";
import test from "node:test";

import { summarizeInvoiceAmounts } from "../app/invoice-amount-summary.ts";

test("groups selected invoices and returns the highest and lowest five amounts", () => {
  const items = [10, 60, 20, 50, 30, 40].map((amount, index) => ({
    id: String(index),
    category: index % 2 ? "交通费" : "餐饮费",
    amount: String(amount),
  }));
  const summary = summarizeInvoiceAmounts(items);

  assert.deepEqual(summary.highest.map((item) => item.amount), ["60", "50", "40", "30", "20"]);
  assert.deepEqual(summary.lowest.map((item) => item.amount), ["10", "20", "30", "40", "50"]);
  assert.equal(summary.categories.length, 2);
  assert.equal(summary.categories.reduce((sum, group) => sum + group.total, 0), 210);
});
