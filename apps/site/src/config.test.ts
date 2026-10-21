import { describe, expect, it } from 'vitest';
import { legalInfo, siteConfig, utmFromSearch } from './config';

describe('siteConfig', () => {
  it('usa a porta da aplicação em desenvolvimento quando nada é informado', () => {
    expect(siteConfig({}).loginUrl).toBe('http://localhost:5173/login');
  });

  it('monta o link de entrada a partir do endereço da aplicação, sem barra duplicada', () => {
    expect(siteConfig({ VITE_APP_URL: 'https://app.exemplo.com.br/' }).loginUrl).toBe(
      'https://app.exemplo.com.br/login',
    );
  });

  it('só habilita o formulário quando há chave de captação', () => {
    expect(siteConfig({}).leadEndpoint).toBeNull();
    expect(siteConfig({ VITE_LEAD_KEY: 'lk_abc' }).leadEndpoint).toBe(
      '/api/v1/public/leads/lk_abc',
    );
  });
});

describe('utmFromSearch', () => {
  it('lê os campos de campanha da URL', () => {
    expect(utmFromSearch('?utm_source=instagram&utm_campaign=lancamento&x=1')).toEqual({
      source: 'instagram',
      medium: undefined,
      campaign: 'lancamento',
      term: undefined,
      content: undefined,
    });
  });

  it('devolve nada quando não há campanha', () => {
    expect(utmFromSearch('?x=1')).toBeUndefined();
  });
});

describe('legalInfo', () => {
  it('não inventa dados da empresa: sem valor no ambiente, o campo fica vazio', () => {
    expect(Object.values(legalInfo({})).every((v) => v === null)).toBe(true);
    expect(legalInfo({ VITE_LEGAL_COMPANY: '  ' }).company).toBeNull();
  });

  it('usa o que o ambiente informa, sem espaços nas pontas', () => {
    const info = legalInfo({
      VITE_LEGAL_COMPANY: ' Voltex SolTech Ltda ',
      VITE_LEGAL_PRIVACY_EMAIL: 'privacidade@exemplo.com.br',
    });
    expect(info.company).toBe('Voltex SolTech Ltda');
    expect(info.privacyEmail).toBe('privacidade@exemplo.com.br');
  });
});
