import assert from "node:assert/strict";
import test from "node:test";

import { buyerValidationIssues, validBuyerTaxId } from "../app/buyer-validation.ts";

test("accepts legacy and unified-credit-code buyer tax identifiers", () => {
  assert.equal(validBuyerTaxId("123456789012345"), true);
  assert.equal(validBuyerTaxId("31310000425013819A"), true);
  assert.equal(validBuyerTaxId("31310000425013819"), false);
});

test("reports missing, malformed, and profile-mismatched buyer data", () => {
  assert.deepEqual(
    buyerValidationIssues(
      { buyerName: "上海甲公司", buyerTaxId: "123", category: "餐饮费" },
      { name: "上海乙公司", taxId: "31310000425013819A" },
    ),
    [
      "购买方税号格式异常（识别为3位）",
      "购买方名称与常用档案不一致",
      "购买方税号与常用档案不一致",
    ],
  );
});

test("does not require invoice parties on payment screenshots", () => {
  assert.deepEqual(
    buyerValidationIssues(
      { category: "微信截图发票" },
      { name: "上海甲公司", taxId: "31310000425013819A" },
    ),
    [],
  );
});
