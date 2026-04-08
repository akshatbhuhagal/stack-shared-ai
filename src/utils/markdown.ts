export function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

export function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function table(headers: string[], rows: string[][]): string {
  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${headerRow}\n${separator}\n${dataRows}`;
}

export function codeBlock(content: string, language = ""): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

export function bold(text: string): string {
  return `**${text}**`;
}

export function joinSections(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}
