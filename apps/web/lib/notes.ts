const markdownFileNameLimit = 80;
const markdownReserved = /[<>:"/\\|?*\u0000-\u001f]/g;

export function noteMarkdownFileName(title: string): string {
  const base = title
    .trim()
    .replace(/^\.+/, "")
    .replace(markdownReserved, "-")
    .replace(/\s+/g, " ")
    .slice(0, markdownFileNameLimit)
    .trim();

  return `${base.length === 0 ? "note" : base}.md`;
}

export function noteMarkdownDocument(title: string, content: string): string {
  const heading = title.trim().length === 0 ? "Untitled note" : title.trim();

  return `# ${heading}\n\n${content}\n`;
}

export function noteExcerpt(content: string, maxLength = 160): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/^\s*[-+]\s+/gm, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= maxLength) {
    return plain;
  }

  return `${plain.slice(0, maxLength).trimEnd()}...`;
}
