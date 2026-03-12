import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Keep code blocks clean
turndown.addRule("pre", {
  filter: "pre",
  replacement(content, node) {
    const code = (node as HTMLElement).querySelector("code");
    const lang = code?.className?.replace("language-", "") ?? "";
    const text = code?.textContent ?? (node as HTMLElement).textContent ?? content;
    return `\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n`;
  },
});

// Remove images (noise for agents)
turndown.addRule("removeImages", {
  filter: "img",
  replacement() {
    return "";
  },
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}
