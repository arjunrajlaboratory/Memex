const test = require('node:test');
const assert = require('node:assert/strict');

const { hardenMarkdownRenderer, wikilinkMarkdown } = require('../dist/main/markdown.js');

test('raw HTML is escaped while safe markdown and resolved wikilinks still render', async () => {
  const { marked, Renderer } = await import('marked');
  const renderer = new Renderer();
  hardenMarkdownRenderer(renderer);
  const md = [
    '# Safe heading',
    '',
    '<style>body{display:none}</style>',
    '<iframe src="https://example.com"></iframe>',
    '<img src=x onerror=alert(1)>',
    '',
    wikilinkMarkdown('A note', 'Atlas/A note.md'),
  ].join('\n');
  const html = marked.parse(md, { renderer });

  assert.match(html, /<h1>Safe heading<\/h1>/);
  assert.doesNotMatch(html, /<style>|<iframe|<img[^>]*onerror=/i);
  assert.match(html, /&lt;style&gt;/);
  assert.match(html, /class="wikilink"/);
  assert.match(html, /data-rel="Atlas\/A note\.md"/);
});

test('unsafe markdown link schemes are rendered as text', async () => {
  const { marked, Renderer } = await import('marked');
  const renderer = new Renderer();
  hardenMarkdownRenderer(renderer);
  const html = marked.parse('[click](javascript:alert(1))', { renderer });
  assert.equal(html.trim(), '<p>click</p>');
});

test('unresolved wikilinks retain their dead-link presentation without raw HTML input', async () => {
  const { marked, Renderer } = await import('marked');
  const renderer = new Renderer();
  hardenMarkdownRenderer(renderer);
  const html = marked.parse(wikilinkMarkdown('Missing note'), { renderer });
  assert.equal(html.trim(), '<p><span class="wikilink dead">Missing note</span></p>');
});
