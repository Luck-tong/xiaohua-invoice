function withFill(xf: string, fillId: number) {
  const updated = xf
    .replace(/\sfillId="\d+"/, ` fillId="${fillId}"`)
    .replace(/\sapplyFill="[^"]*"/, "");
  return updated.replace(/\s*\/>$/, ' applyFill="1"/>');
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
  const fills = styles.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/);
  const cellXfs = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!fills || !cellXfs) return data;

  const fillCount = Number(fills[1]);
  const blueFillId = fillCount;
  const redFillId = fillCount + 1;
  const addedFills = [
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE7E7"/><bgColor indexed="64"/></patternFill></fill>',
  ].join("");
  styles = styles.replace(
    fills[0],
    `<fills count="${fillCount + 2}">${fills[2]}${addedFills}</fills>`,
  );

  const existingXfs = cellXfs[2].match(/<xf\b[^>]*\/>/g) ?? [];
  if (existingXfs.length === 0) return data;
  const headerStyleId = existingXfs.length;
  const redStyleStart = headerStyleId + 1;
  const addedXfs = [
    withFill(existingXfs[0]!, blueFillId),
    ...existingXfs.map((xf) => withFill(xf, redFillId)),
  ].join("");
  styles = styles.replace(
    cellXfs[0],
    `<cellXfs count="${existingXfs.length * 2 + 1}">${cellXfs[2]}${addedXfs}</cellXfs>`,
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
    if (!incompleteRows[row]) continue;
    const excelRow = row + 2;
    for (let column = 0; column < columnCount; column += 1) {
      const reference = `${columnName(column)}${excelRow}`;
      const cellMatch = sheet.match(new RegExp(`<c([^>]*\\sr="${reference}"[^>]*)>`));
      const currentStyle = Number(cellMatch?.[1].match(/\ss="(\d+)"/)?.[1] ?? 0);
      sheet = setCellStyle(sheet, reference, redStyleStart + currentStyle);
    }
  }

  zip.file("xl/styles.xml", styles);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generateAsync({ type: "arraybuffer" });
}
