import { config, utmFromSearch } from './config';

type Field = HTMLInputElement;

/** Corpo aceito pelo endereço público de captação do CRM (mesmo formulário que qualquer empresa usa no próprio site). */
export function buildPayload(values: {
  name: string;
  phone: string;
  email: string;
  company: string;
}) {
  const clean = (v: string) => v.trim() || undefined;
  const company = clean(values.company);
  return {
    name: values.name.trim(),
    phone: clean(values.phone),
    email: clean(values.email),
    notes: company
      ? `Empresa: ${company}. Pediu demonstração pelo site.`
      : 'Pediu demonstração pelo site.',
    utm: utmFromSearch(window.location.search),
    consent: true as const,
    website: '',
  };
}

function problem(
  values: { name: string; phone: string; email: string },
  consent: boolean,
): string | null {
  if (values.name.trim().length < 2) return 'Informe seu nome.';
  if (!values.phone.trim() && !values.email.trim())
    return 'Informe um telefone ou um e-mail para a gente retornar.';
  if (values.email.trim() && !/^\S+@\S+\.\S+$/.test(values.email.trim()))
    return 'Esse e-mail não parece certo.';
  if (!consent) return 'Marque a caixa para a gente poder entrar em contato.';
  return null;
}

export function initForm() {
  const form = document.querySelector<HTMLFormElement>('[data-form]');
  const msg = form?.querySelector<HTMLElement>('[data-msg]');
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !msg || !button) return;

  const field = (name: string) => form.elements.namedItem(name) as Field;
  const say = (text: string, ok = false) => {
    msg.textContent = text;
    msg.classList.toggle('is-ok', ok);
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {
      name: field('name').value,
      phone: field('phone').value,
      email: field('email').value,
      company: field('company').value,
    };
    const issue = problem(values, field('consent').checked);
    for (const name of ['name', 'phone', 'email']) field(name).removeAttribute('aria-invalid');
    if (issue) {
      if (values.name.trim().length < 2) field('name').setAttribute('aria-invalid', 'true');
      return say(issue);
    }
    if (field('website').value) return say('Recebemos seu contato. Obrigado!', true); // robô: finge sucesso

    if (!config.leadEndpoint) {
      console.warn('Formulário sem chave de captação: defina VITE_LEAD_KEY.');
      return say('Não foi possível enviar agora. Tente novamente em instantes.');
    }
    button.disabled = true;
    say('Enviando…');
    // A primeira chamada depois de um tempo parado pode levar até 1 minuto (o servidor acorda): avisa em vez de parecer travado.
    const slow = window.setTimeout(
      () =>
        say(
          'Ainda enviando… o servidor pode estar acordando (leva até 1 minuto). Não feche a página.',
        ),
      5_000,
    );
    const controller = new AbortController();
    const giveUp = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(config.leadEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(values)),
        signal: controller.signal,
      });
      if (res.status === 429) return say('Muitas tentativas. Aguarde um minuto e tente de novo.');
      if (!res.ok)
        return say('Não foi possível enviar agora. Confira os dados ou tente em instantes.');
      form.reset();
      say('Recebemos seu contato. A gente retorna em breve!', true);
    } catch {
      say(
        controller.signal.aborted
          ? 'Demorou mais que o normal. Seu contato pode já ter chegado; se não tiver retorno, envie de novo (não cria duplicado).'
          : 'Sem conexão com o servidor. Tente novamente em instantes.',
      );
    } finally {
      window.clearTimeout(slow);
      window.clearTimeout(giveUp);
      button.disabled = false;
    }
  });
}
