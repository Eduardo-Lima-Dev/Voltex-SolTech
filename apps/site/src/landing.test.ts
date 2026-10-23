import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('landing page reflete o sistema', () => {
  it('Engine e Off-Grid não aparecem mais como "em desenvolvimento"', () => {
    expect(text).not.toMatch(/Em desenvolvimento/i);
    expect(text).not.toMatch(/estão em desenvolvimento/i);
    expect(text).toMatch(/Solar Engine Studio/);
    expect(text).toMatch(/Off-Grid Designer/);
    expect(text.match(/Em validação/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('tem a seção de engenharia, ligada no menu, com o aviso de ferramenta de apoio', () => {
    expect(html).toContain('id="engenharia"');
    expect(html).toContain('href="#engenharia"');
    expect(text).toMatch(/não substitui o projeto assinado por profissional habilitado/);
    expect(text).toMatch(/quem assina é o engenheiro/);
  });

  it('não promete que a plataforma emite ART/TRT (os Termos dizem que não emite)', () => {
    expect(text).not.toMatch(/ART\/TRT emitida/);
    expect(text).toMatch(/ART\/TRT registrada/);
  });

  it('a FAQ cobre responsabilidade, regras e modo de teste interno', () => {
    expect(text).toMatch(/O sistema substitui o engenheiro\?/);
    expect(text).toMatch(/Quem define as regras e as normas técnicas\?/);
    expect(text).toMatch(/Posso testar o Engine sem as regras revisadas\?/);
  });

  it('os rótulos das seções seguem a ordem 01 a 07, sem repetir número', () => {
    const labels = [...html.matchAll(/class="label[^"]*">(\d\d) —/g)].map((m) => m[1]);
    expect(labels).toEqual(['01', '02', '03', '04', '05', '06', '07']);
  });
});

describe('landing page cobre a execução e o pós-venda', () => {
  it('apresenta os cinco produtos, com a Operação disponível', () => {
    expect(text).toMatch(/Cinco produtos, um cadastro/);
    expect(text).not.toMatch(/Quatro produtos/);
    expect(text).toMatch(/Operação\s+Da obra homologada à planta entregue/);
  });

  it('descreve campo offline, portal, pós-venda e financeiro sem prometer pagamento nem assinatura eletrônica', () => {
    expect(text).toMatch(/App de campo, mesmo sem sinal/);
    expect(text).toMatch(/Portal do cliente/);
    expect(text).toMatch(/Pós-venda e garantias/);
    expect(text).toMatch(/O sistema não processa pagamentos/);
    expect(text).not.toMatch(/gateway|Pix automático|assinatura eletrônica|DocuSeal/i);
  });

  it('cita a verificação em duas etapas', () => {
    expect(text).toMatch(/Verificação em duas etapas/);
  });
});
