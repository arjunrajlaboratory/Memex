import { isSafeExternalUrl } from './security';

interface MarkdownRenderer {
  html(html: string, block?: boolean): string;
  link(href: string, title: string | null | undefined, text: string): string;
  image(href: string, title: string | null, text: string): string;
}

const escapeText = (value: unknown): string => String(value ?? '').replace(/[&<>]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;',
} as Record<string, string>)[char]);

const escapeAttribute = (value: unknown): string => String(value ?? '').replace(/[&<>"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
} as Record<string, string>)[char]);

const escapeMarkdownText = (value: string): string => value.replace(/([\\`*_[\]{}()#+.!|>~-])/g, '\\$1');

/** Render a resolved wikilink without introducing raw HTML into the Markdown input. */
export function wikilinkMarkdown(label: string, rel?: string): string {
  const safeLabel = escapeMarkdownText(String(label || ''));
  return rel ? `[${safeLabel}](memex-note:${encodeURIComponent(rel)})` : `[${safeLabel}](memex-dead:)`;
}

/**
 * Marked supports raw HTML by default. Replace that behavior with escaped text and
 * admit only the two link forms the privileged renderer understands.
 */
export function hardenMarkdownRenderer(renderer: MarkdownRenderer): void {
  renderer.html = (html: string) => escapeText(html);
  renderer.link = (href: string, title: string | null | undefined, text: string) => {
    if (href.startsWith('memex-note:')) {
      try {
        const rel = decodeURIComponent(href.slice('memex-note:'.length));
        return `<a class="wikilink" data-rel="${escapeAttribute(rel)}">${text}</a>`;
      } catch (_) {
        return text;
      }
    }
    if (href === 'memex-dead:') return `<span class="wikilink dead">${text}</span>`;
    if (!isSafeExternalUrl(href)) return text;
    const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
    return `<a href="${escapeAttribute(href)}"${titleAttr}>${text}</a>`;
  };
  renderer.image = (href: string, title: string | null, text: string) => {
    if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(href)) return escapeText(text);
    const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
    return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttr}>`;
  };
}
