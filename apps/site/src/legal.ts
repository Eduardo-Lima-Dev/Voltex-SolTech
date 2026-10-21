import './styles.css';
import './legal.css';
import { config, legalInfo, LEGAL_FIELDS } from './config';

// Os botões "Entrar" levam à aplicação, que fica em outro endereço.
document
  .querySelectorAll<HTMLAnchorElement>('[data-login]')
  .forEach((a) => (a.href = config.loginUrl));

// Dados da empresa vêm do ambiente. Sem valor, o texto "a informar" continua visível: nada é inventado.
const info = legalInfo(import.meta.env);
for (const field of LEGAL_FIELDS) {
  const value = info[field];
  if (!value) continue;
  document.querySelectorAll(`[data-legal="${field}"]`).forEach((el) => {
    el.textContent = value;
    el.classList.remove('legal__todo');
  });
}
document
  .querySelectorAll<HTMLAnchorElement>('a[data-legal-mail]')
  .forEach((a) => (a.href = info.privacyEmail ? `mailto:${info.privacyEmail}` : '#contato'));
