import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_FIELDS } from './config';

const page = (name: string) => readFileSync(resolve(__dirname, '..', name), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('páginas legais', () => {
  const privacy = page('privacidade.html');
  const terms = page('termos.html');

  it('a política cita a LGPD, os papéis, os direitos do titular e a retenção', () => {
    const t = text(privacy);
    expect(t).toMatch(/Lei 13\.709\/2018/);
    expect(t).toMatch(/Controladora/);
    expect(t).toMatch(/Operadora/);
    expect(t).toMatch(/art\. 18/);
    expect(t).toMatch(/no mínimo 5 anos/);
    expect(t).toMatch(/Encarregado/);
  });

  it('os termos deixam claro que ações e decisões são de quem usa e que a ferramenta não substitui o engenheiro', () => {
    const t = text(terms);
    expect(t).toMatch(/responsabilidade exclusiva das pessoas e empresas que a utilizam/);
    expect(t).toMatch(/Não presta serviço de engenharia/);
    expect(t).toMatch(/não emite ART, TRT ou RRT/);
    expect(t).toMatch(/teste interno/);
  });

  it('os dados da empresa só aparecem se informados: cada campo tem o aviso "a informar" e um marcador', () => {
    for (const field of LEGAL_FIELDS) {
      const used =
        privacy.includes(`data-legal="${field}"`) || terms.includes(`data-legal="${field}"`);
      expect(used, field).toBe(true);
    }
    expect(privacy).toMatch(/\[[^\]]*a informar\]/);
  });

  it('as duas páginas se ligam entre si e a página inicial liga nas duas', () => {
    expect(privacy).toContain('href="/termos"');
    expect(terms).toContain('href="/privacidade"');
    const home = page('index.html');
    expect(home).toContain('href="/privacidade"');
    expect(home).toContain('href="/termos"');
  });
});

describe('IA nas páginas legais (Fase 12)', () => {
  const privacy = text(page('privacidade.html'));
  const terms = text(page('termos.html'));

  it('a política diz o que vai ao provedor de IA, o que não vai e por quanto tempo as conversas ficam', () => {
    expect(privacy).toMatch(/Provedor de inteligência artificial/);
    expect(privacy).toMatch(/sem dados pessoais/);
    expect(privacy).toMatch(/suboperador/);
    expect(privacy).toMatch(/Conversas com o assistente de IA/);
    expect(privacy).toMatch(/não usa esses dados para treinar modelos/);
  });

  it('os termos dizem que a IA é opcional, só consulta, pode errar e não decide', () => {
    expect(terms).toMatch(/Assistente de inteligência artificial/);
    expect(terms).toMatch(/opcional/);
    expect(terms).toMatch(/apenas consulta/);
    expect(terms).toMatch(/podem conter erros/);
    expect(terms).toMatch(/não toma decisões/);
  });

  it('a página inicial não promete o que a IA não faz', () => {
    const home = text(page('index.html'));
    expect(home).toMatch(/O que a IA faz\? E o que ela não faz\?/);
    expect(home).toMatch(/não substitui o engenheiro/);
  });
});
