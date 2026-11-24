import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contactLinks, demoHref, INSTAGRAM } from './config';

const page = readFileSync(resolve(__dirname, '..', 'links.html'), 'utf8');

describe('página de links', () => {
  it('o WhatsApp vira link wa.me com DDI do Brasil e mensagem pronta; número curto é descartado', () => {
    expect(contactLinks({ VITE_CONTACT_WHATSAPP: '(85) 99999-0000' }).whatsapp).toMatch(
      /^https:\/\/wa\.me\/5585999990000\?text=Ol%C3%A1/,
    );
    expect(contactLinks({ VITE_CONTACT_WHATSAPP: '+55 85 99999-0000' }).whatsapp).toMatch(
      /^https:\/\/wa\.me\/5585999990000\?/,
    );
    expect(contactLinks({ VITE_CONTACT_WHATSAPP: '9999' }).whatsapp).toBeNull();
    expect(contactLinks({}).whatsapp).toBeNull();
  });

  it('e-mail e LinkedIn só aparecem quando informados (LinkedIn só com https)', () => {
    expect(contactLinks({}).email).toBeNull();
    expect(contactLinks({ VITE_CONTACT_EMAIL: ' contato@voltex.com.br ' }).email).toBe(
      'mailto:contato@voltex.com.br',
    );
    expect(contactLinks({ VITE_LINKEDIN_URL: 'javascript:alert(1)' }).linkedin).toBeNull();
    expect(
      contactLinks({ VITE_LINKEDIN_URL: 'https://www.linkedin.com/company/voltex' }).linkedin,
    ).toBe('https://www.linkedin.com/company/voltex');
  });

  it('o pedido de demonstração leva a campanha de quem chegou (ex.: QR code) até o formulário', () => {
    expect(demoHref('?utm_source=qrcode&utm_medium=apresentacao&x=1')).toBe(
      '/?utm_source=qrcode&utm_medium=apresentacao#contato',
    );
    expect(demoHref('')).toBe('/?utm_source=link-bio#contato');
  });

  it('a página tem sobre, contato, Instagram oficial, equipe e demonstração', () => {
    expect(page).toContain(INSTAGRAM.url);
    for (const marker of [
      'data-contact',
      'data-demo',
      'data-team',
      'sobre-titulo',
      'demo-titulo',
    ]) {
      expect(page, marker).toContain(marker);
    }
  });
});
