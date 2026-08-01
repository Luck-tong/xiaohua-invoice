import assert from "node:assert/strict";
import test from "node:test";

import { filterFilesByCategories } from "../app/category-selection.ts";

test("filters all ready files by one or more selected categories", () => {
  const files = [
    { id: "1", category: "住宿费" },
    { id: "2", category: "交通费" },
    { id: "3", category: "住宿费" },
  ];

  assert.deepEqual(
    filterFilesByCategories(files, new Set(["住宿费"])).map((item) => item.id),
    ["1", "3"],
  );
  assert.deepEqual(
    filterFilesByCategories(files, new Set(["住宿费", "交通费"])).map(
      (item) => item.id,
    ),
    ["1", "2", "3"],
  );
});
