import { PDFDocument } from "pdf-lib";

export type PdfInvoicesPerPage = 1 | 2 | 4;

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 22;
const CELL_GAP = 12;

function gridFor(perPage: PdfInvoicesPerPage) {
  if (perPage === 4) return { columns: 2, rows: 2 };
  if (perPage === 2) return { columns: 1, rows: 2 };
  return { columns: 1, rows: 1 };
}

export async function mergeInvoicePdfBytes(
  sources: ArrayBuffer[],
  perPage: PdfInvoicesPerPage,
) {
  const merged = await PDFDocument.create();
  if (perPage === 1) {
    for (const bytes of sources) {
      const source = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }
    return merged.save();
  }

  const sourcePages = [];
  for (const bytes of sources) {
    const source = await PDFDocument.load(bytes);
    for (const page of source.getPages()) {
      sourcePages.push(await merged.embedPage(page));
    }
  }

  const { columns, rows } = gridFor(perPage);
  const cellWidth = (A4_WIDTH - PAGE_MARGIN * 2 - CELL_GAP * (columns - 1)) / columns;
  const cellHeight = (A4_HEIGHT - PAGE_MARGIN * 2 - CELL_GAP * (rows - 1)) / rows;

  sourcePages.forEach((sourcePage, index) => {
    if (index % perPage === 0) merged.addPage([A4_WIDTH, A4_HEIGHT]);
    const target = merged.getPages().at(-1)!;
    const cellIndex = index % perPage;
    const column = cellIndex % columns;
    const row = Math.floor(cellIndex / columns);
    const scale = Math.min(cellWidth / sourcePage.width, cellHeight / sourcePage.height);
    const width = sourcePage.width * scale;
    const height = sourcePage.height * scale;
    const cellX = PAGE_MARGIN + column * (cellWidth + CELL_GAP);
    const cellTop = A4_HEIGHT - PAGE_MARGIN - row * (cellHeight + CELL_GAP);

    target.drawPage(sourcePage, {
      x: cellX + (cellWidth - width) / 2,
      y: cellTop - cellHeight + (cellHeight - height) / 2,
      width,
      height,
    });
  });

  return merged.save();
}
