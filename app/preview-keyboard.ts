export function adjacentPreviewId(
  ids: string[],
  activeId: string | undefined,
  direction: 1 | -1,
) {
  if (ids.length === 0) return undefined;
  const currentIndex = Math.max(0, ids.indexOf(activeId ?? ""));
  const nextIndex = Math.min(
    ids.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return ids[nextIndex];
}
