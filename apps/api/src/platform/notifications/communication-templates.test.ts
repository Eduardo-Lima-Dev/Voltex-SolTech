import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_TEMPLATES,
  findTemplate,
  renderTemplate,
  templateVariables,
} from './communication-templates';

describe('modelos de comunicação', () => {
  it('lista as variáveis de cada modelo', () => {
    expect(templateVariables(findTemplate('installation.scheduled')!)).toEqual([
      'nome',
      'data',
      'janela',
    ]);
  });
  it('preenche as variáveis', () => {
    const r = renderTemplate(findTemplate('portal.access')!, { nome: 'Ana', link: 'https://x/y' });
    expect(r.missing).toEqual([]);
    expect(r.text).toContain('Olá, Ana!');
    expect(r.text).toContain('https://x/y');
  });
  it('aponta variável faltando em vez de deixar o marcador no texto', () => {
    const r = renderTemplate(findTemplate('portal.access')!, { nome: 'Ana' });
    expect(r.missing).toEqual(['link']);
  });
  it('tem ids únicos', () => {
    const ids = COMMUNICATION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
