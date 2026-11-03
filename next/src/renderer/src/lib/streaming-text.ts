// Markdown that is still arriving. A table only renders once its header and separator row are both
// complete; until then the half-written rows would show as raw pipes, so they are held back.

const SEPARATOR_CELL = /^\s*:?-{3,}:?\s*$/

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")

/** Hides a table at the end of the text until its header and separator row are complete. */
export function holdPartialTable(text: string): string {
  const lines = text.split("\n")
  let start = lines.length
  while (start > 0 && lines[start - 1]!.trimStart().startsWith("|")) start--
  if (start === lines.length) return text
  const table = lines.slice(start)
  const header = table[0]!
  const separator = table[1]
  const complete =
    separator !== undefined &&
    table.length > 2 &&
    cells(separator).length === cells(header).length &&
    cells(separator).every((c) => SEPARATOR_CELL.test(c))
  return complete ? text : lines.slice(0, start).join("\n").replace(/\s+$/, "")
}

/**
 * Some free models write their thinking between <think> tags in the answer itself, or leave a stray
 * closing tag. Neither is part of the answer.
 */
export const dropThinkTags = (text: string) => text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/<\/?think>/g, "")
