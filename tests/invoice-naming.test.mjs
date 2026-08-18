import assert from "node:assert/strict";
import test from "node:test";

import { buildInvoiceNames } from "../app/invoice-naming.ts";

test("numbers every file when invoice number and amount collide", () => {
  const names = buildInvoiceNames([
    { id: "a", number: "123", amount: "88.00", fileName: "a.pdf" },
    { id: "b", number: "123", amount: "88.00", fileName: "b.pdf" },
  ]);

  assert.equal(names.get("a"), "123（88.00）（1）.pdf");
  assert.equal(names.get("b"), "123（88.00）（2）.pdf");
});

test("keeps amount-based names when amounts differ", () => {
  const names = buildInvoiceNames([
    { id: "a", number: "123", amount: "88.00", fileName: "a.pdf" },
    { id: "b", number: "123", amount: "99.00", fileName: "b.pdf" },
  ]);

  assert.equal(names.get("a"), "123（88.00）.pdf");
  assert.equal(names.get("b"), "123（99.00）.pdf");
});
