import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";
import { unpackInvoiceZip } from "../app/invoice-recognition.ts";

test("unpacks supported invoice files and preserves their folder source", async () => {
  const zip = new JSZip();
  zip.file("一月/餐饮发票.pdf", new Uint8Array([1, 2, 3]));
  zip.file("一月/付款截图.png", new Uint8Array([4, 5]));
  zip.file("说明.txt", "not an invoice");
  const bytes = await zip.generateAsync({ type: "uint8array" });

  const files = await unpackInvoiceZip(new File([bytes], "归档.zip", {
    type: "application/zip",
    lastModified: 123,
  }));

  assert.deepEqual(files.map((item) => item.file.name), ["餐饮发票.pdf", "付款截图.png"]);
  assert.deepEqual(files.map((item) => item.sourcePath), ["一月", "一月"]);
  assert.equal(files[0].file.lastModified, 123);
});
