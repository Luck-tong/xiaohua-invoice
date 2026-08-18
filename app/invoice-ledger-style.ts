function withCenteredStyle(
  xf: string,
  options: { fillId?: number; fontId?: number } = {},
) {
  let updated = xf.replace(/\s*\/>$/, "");
  if (options.fillId !== undefined) {
    updated = /\sfillId="\d+"/.test(updated)
      ? updated.replace(/\sfillId="\d+"/, ` fillId="${options.fillId}"`)
      : `${updated} fillId="${options.fillId}"`;
    updated = updated.replace(/\sapplyFill="[^"]*"/, "");
    updated += ' applyFill="1"';
  }
  if (options.fontId !== undefined) {
    updated = /\sfontId="\d+"/.test(updated)
      ? updated.replace(/\sfontId="\d+"/, ` fontId="${options.fontId}"`)
      : `${updated} fontId="${options.fontId}"`;
    updated = updated.replace(/\sapplyFont="[^"]*"/, "");
    updated += ' applyFont="1"';
  }
  updated = updated.replace(/\sapplyAlignment="[^"]*"/, "");
  return `${updated} applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;
}

function setCellStyle(xml: string, cellReference: string, styleId: number) {
  const pattern = new RegExp(`<c([^>]*\\sr="${cellReference}"[^>]*)>`, "g");
  return xml.replace(pattern, (_match, attributes: string) => {
    const styled = /\ss="\d+"/.test(attributes)
      ? attributes.replace(/\ss="\d+"/, ` s="${styleId}"`)
      : `${attributes} s="${styleId}"`;
    return `<c${styled}>`;
  });
}

export async function styleInvoiceLedgerXlsx(
  data: ArrayBuffer,
  rowCount: number,
  columnCount: number,
  incompleteRows: boolean[],
) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const stylesFile = zip.file("xl/styles.xml");
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!stylesFile || !sheetFile) return data;

  let styles = await stylesFile.async("string");
  let sheet = await sheetFile.async("string");
  const fonts = styles.match(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/);
  const fills = styles.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/);
  const cellXfs = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!fonts || !fills || !cellXfs) return data;

  const fontCount = Number(fonts[1]);
  const headerFontId = fontCount;
  const headerFont = '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>';
  styles = styles.replace(
    fonts[0],
    `<fonts count="${fontCount + 1}">${fonts[2]}${headerFont}</fonts>`,
  );

  const fillCount = Number(fills[1]);
  const headerFillId = fillCount;
  const redFillId = fillCount + 1;
  const addedFills = [
    '<fill><patternFill patternType="solid"><fgColor rgb="FF5B6B92"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE7E7"/><bgColor indexed="64"/></patternFill></fill>',
  ].join("");
  styles = styles.replace(
    fills[0],
    `<fills count="${fillCount + 2}">${fills[2]}${addedFills}</fills>`,
  );

  const existingXfs = cellXfs[2].match(/<xf\b[^>]*\/>/g) ?? [];
  if (existingXfs.length === 0) return data;
  const headerStyleId = existingXfs.length;
  const centeredStyleStart = headerStyleId + 1;
  const redStyleStart = centeredStyleStart + existingXfs.length;
  const addedXfs = [
    withCenteredStyle(existingXfs[0]!, { fillId: headerFillId, fontId: headerFontId }),
    ...existingXfs.map((xf) => withCenteredStyle(xf)),
    ...existingXfs.map((xf) => withCenteredStyle(xf, { fillId: redFillId })),
  ].join("");
  styles = styles.replace(
    cellXfs[0],
    `<cellXfs count="${existingXfs.length * 3 + 1}">${cellXfs[2]}${addedXfs}</cellXfs>`,
  );

  const columnName = (index: number) => {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  };

  for (let column = 0; column < columnCount; column += 1) {
    sheet = setCellStyle(sheet, `${columnName(column)}1`, headerStyleId);
  }
  for (let row = 0; row < rowCount; row += 1) {
    const excelRow = row + 2;
    for (let column = 0; column < columnCount; column += 1) {
      const reference = `${columnName(column)}${excelRow}`;
      const cellMatch = sheet.match(new RegExp(`<c([^>]*\\sr="${reference}"[^>]*)>`));
      const currentStyle = Number(cellMatch?.[1].match(/\ss="(\d+)"/)?.[1] ?? 0);
      const styleStart = incompleteRows[row] ? redStyleStart : centeredStyleStart;
      sheet = setCellStyle(sheet, reference, styleStart + currentStyle);
    }
  }

  zip.file("xl/styles.xml", styles);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generateAsync({ type: "arraybuffer" });
}
