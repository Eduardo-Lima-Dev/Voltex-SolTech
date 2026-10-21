import { describe, expect, it } from 'vitest';
import { diffLines, htmlToText, normalizeText } from './watch.js';

describe('htmlToText e normalizeText', () => {
  it('tira scripts, estilos, comentários e tags, e decodifica entidades', () => {
    const html =
      '<html><head><style>.a{}</style><script>var x=1</script></head><body><!-- c --><h1>Resolução&nbsp;1.000</h1><p>Art. 1º &amp; 2º</p><ul><li>a</li><li>b</li></ul></body></html>';
    expect(normalizeText(htmlToText(html))).toBe('Resolução 1.000\nArt. 1º & 2º\na\nb');
  });

  it('entidade desconhecida vira espaço e a normalização remove linhas vazias', () => {
    expect(normalizeText(htmlToText('a&bogus;b'))).toBe('a&bogus;b');
    expect(normalizeText('  a   b \r\n\r\n  c  ')).toBe('a b\nc');
  });
});

describe('diffLines', () => {
  it('textos iguais não mudam, mesmo com ordem diferente', () => {
    expect(diffLines('a\nb', 'b\na').changed).toBe(false);
  });

  it('mostra o que entrou e o que saiu, com contagem', () => {
    const d = diffLines('a\nb\nc', 'a\nc\nd\nd');
    expect(d.added).toEqual(['d', 'd']);
    expect(d.removed).toEqual(['b']);
    expect(d.addedCount).toBe(2);
    expect(d.removedCount).toBe(1);
    expect(d.changed).toBe(true);
  });

  it('limita as linhas mostradas mas conta todas', () => {
    const after = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n');
    const d = diffLines('', after);
    expect(d.added).toHaveLength(40);
    expect(d.addedCount).toBe(100);
  });
});
