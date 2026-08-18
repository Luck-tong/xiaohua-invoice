type InvoiceNameInput = {
  id: string;
  number: string;
  amount: string;
  fileName: string;
};

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

export function buildInvoiceNames(items: InvoiceNameInput[]) {
  const groups = new Map<string, InvoiceNameInput[]>();
  items.forEach((item) => {
    const baseName = `${item.number}（${item.amount}）${extensionOf(item.fileName)}`;
    groups.set(baseName, [...(groups.get(baseName) ?? []), item]);
  });

  const names = new Map<string, string>();
  groups.forEach((group, baseName) => {
    const extension = extensionOf(baseName);
    const stem = extension ? baseName.slice(0, -extension.length) : baseName;
    group.forEach((item, index) => {
      names.set(
        item.id,
        group.length === 1 ? baseName : `${stem}（${index + 1}）${extension}`,
      );
    });
  });
  return names;
}
