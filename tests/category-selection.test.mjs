import assert from "node:assert/strict";
import test from "node:test";

import {
  DUPLICATE_DOWNLOAD_GROUP,
  filterFilesByCategories,
  filterFilesByDownloadGroups,
} from "../app/category-selection.ts";

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

test("keeps duplicate invoices in an independent download group", () => {
  const files = [
    { id: "1", category: "住宿费" },
    { id: "2", category: "住宿费" },
    { id: "3", category: "交通费" },
  ];
  const duplicateIds = new Set(["1", "2"]);

  assert.deepEqual(
    filterFilesByDownloadGroups(files, new Set(["住宿费"]), duplicateIds),
    [],
  );
  assert.deepEqual(
    filterFilesByDownloadGroups(
      files,
      new Set([DUPLICATE_DOWNLOAD_GROUP]),
      duplicateIds,
    ).map((item) => item.id),
    ["1", "2"],
  );
  assert.deepEqual(
    filterFilesByDownloadGroups(
      files,
      new Set(["交通费", DUPLICATE_DOWNLOAD_GROUP]),
      duplicateIds,
    ).map((item) => item.id),
    ["1", "2", "3"],
  );
});
