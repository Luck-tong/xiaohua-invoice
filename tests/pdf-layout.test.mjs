import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { mergeInvoicePdfBytes } from "../app/pdf-layout.ts";

async function samplePdf(width = 800, height = 500) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width, height]);
  page.drawText("invoice", { x: 20, y: 20 });
  return (await pdf.save()).buffer;
}

test("keeps one source page per output page", async () => {
  const bytes = await mergeInvoicePdfBytes(
    [await samplePdf(), await samplePdf(), await samplePdf()],
    1,
  );
  const output = await PDFDocument.load(bytes);
  assert.equal(output.getPageCount(), 3);
});

test("places two or four invoice pages on each A4 page", async () => {
  const sources = await Promise.all(Array.from({ length: 5 }, () => samplePdf()));
  const twoUp = await PDFDocument.load(await mergeInvoicePdfBytes(sources, 2));
  const fourUp = await PDFDocument.load(await mergeInvoicePdfBytes(sources, 4));

  assert.equal(twoUp.getPageCount(), 3);
  assert.equal(fourUp.getPageCount(), 2);
  assert.deepEqual(twoUp.getPage(0).getSize(), { width: 595.28, height: 841.89 });
});
