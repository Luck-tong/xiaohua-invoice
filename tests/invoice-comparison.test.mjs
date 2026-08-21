import assert from "node:assert/strict";
import test from "node:test";

import { compareInvoiceBatches } from "../app/invoice-comparison.ts";

test("compares two manually supplied invoice batches and keeps exact duplicates", () => {
  const result = compareInvoiceBatches(
    [
      { id: "left-a", number: "123", amount: "100", category: "餐饮费" },
      { id: "left-b", number: "456", amount: "200", category: "交通费" },
    ],
    [
      { id: "right-a", number: "123", amount: "100", category: "餐饮费" },
      { id: "right-b", number: "789", amount: "300", category: "餐饮费" },
      { id: "right-c", number: "123", amount: "101", category: "餐饮费" },
    ],
  );

  assert.deepEqual(result.categories, [
    { category: "餐饮费", leftCount: 1, leftAmount: 100, rightCount: 3, rightAmount: 501 },
    { category: "交通费", leftCount: 1, leftAmount: 200, rightCount: 0, rightAmount: 0 },
  ]);
  assert.deepEqual(result.duplicateGroups, [
    {
      key: "123::100.00",
      number: "123",
      amount: "100",
      leftIds: ["left-a"],
      rightIds: ["right-a"],
    },
  ]);
});
