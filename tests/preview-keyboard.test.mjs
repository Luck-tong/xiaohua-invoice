import assert from "node:assert/strict";
import test from "node:test";

import { adjacentPreviewId } from "../app/preview-keyboard.ts";

test("moves through preview items without wrapping", () => {
  const ids = ["first", "second", "third"];

  assert.equal(adjacentPreviewId(ids, "first", 1), "second");
  assert.equal(adjacentPreviewId(ids, "second", -1), "first");
  assert.equal(adjacentPreviewId(ids, "third", 1), "third");
  assert.equal(adjacentPreviewId(ids, "first", -1), "first");
});
