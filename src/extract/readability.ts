import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ReadableArticle {
  title: string;
  content: string;       // cleaned HTML
  textContent: string;   // plain text
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;        // char count
}

export function extractReadable(html: string, url: string): ReadableArticle | null {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) return null;

  return {
    title: article.title,
    content: article.content,
    textContent: article.textContent,
    excerpt: article.excerpt,
    byline: article.byline,
    siteName: article.siteName,
    length: article.length,
  };
}
