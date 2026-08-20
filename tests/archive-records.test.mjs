import assert from "node:assert/strict";
import test from "node:test";

import { filterArchiveRecords } from "../app/archive-records.ts";

const records = [
  {
    id: "1", importedAt: "2026-08-18T10:00:00.000Z", invoiceDate: "2026-08-16",
    originalName: "餐饮.pdf", generatedName: "2691（88）.pdf", source: "旧档案.zip › 一月",
    number: "2691", amount: "88", sellerName: "上海餐饮有限公司", category: "餐饮费",
    status: "ready", issues: [],
  },
  {
    id: "2", importedAt: "2026-08-20T11:00:00.000Z", invoiceDate: "2026-08-20",
    originalName: "住宿.pdf", generatedName: "2692（500）.pdf", source: "新档案",
    number: "2692", amount: "500", sellerName: "上海酒店", category: "住宿费",
    status: "ready", issues: ["购买方税号格式异常"],
  },
];

test("filters archive metadata by keyword and invoice date", () => {
  assert.deepEqual(
    filterArchiveRecords(records, { query: "酒店", from: "2026-08-19", to: "2026-08-21" }).map((item) => item.id),
    ["2"],
  );
  assert.deepEqual(
    filterArchiveRecords(records, { query: "旧档案" }).map((item) => item.id),
    ["1"],
  );
});

test("filters import time by timestamp instead of comparing mixed date strings", () => {
  assert.deepEqual(
    filterArchiveRecords(records, {
      dateField: "importedAt",
      from: "2026-08-20T18:30",
      to: "2026-08-20T20:00",
    }).map((item) => item.id),
    ["2"],
  );
});
