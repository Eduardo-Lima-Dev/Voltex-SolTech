import '@fontsource-variable/inter';
import './links.css';
import { config, contactLinks, demoHref } from './config';

/** Pessoas da equipe na página de links. `photo` é um arquivo em `public/` (sem foto, mostra as iniciais). */
export interface TeamMember {
  name: string;
  role: string;
  photo?: string;
  linkedin?: string;
}

export const TEAM: TeamMember[] = [
  { name: 'Eduardo Borges', role: 'Fundador e CTO', photo: '/equipe/eduardo.jpg' },
  { name: 'Letícia', role: 'Cofundadora', photo: '/equipe/leticia.jpg' },
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function renderTeam(list: HTMLElement, team: TeamMember[]) {
  for (const member of team) {
    const li = document.createElement('li');
    const avatar = document.createElement(member.photo ? 'img' : 'span');
    avatar.className = 'bio__person-avatar';
    if (avatar instanceof HTMLImageElement && member.photo) {
      avatar.src = member.photo;
      avatar.alt = '';
    } else {
      avatar.textContent = initials(member.name);
      avatar.setAttribute('aria-hidden', 'true');
    }
    const text = document.createElement('div');
    const name = document.createElement(member.linkedin ? 'a' : 'strong');
    name.textContent = member.name;
    if (name instanceof HTMLAnchorElement && member.linkedin) {
      name.href = member.linkedin;
      name.target = '_blank';
      name.rel = 'noopener';
    }
    const role = document.createElement('span');
    role.textContent = member.role;
    text.append(name, role);
    li.append(avatar, text);
    list.append(li);
  }
}

const links = contactLinks(import.meta.env);

// "Entrar em contato" abre o WhatsApp quando há número; sem número, cai no formulário do site.
document.querySelectorAll<HTMLAnchorElement>('[data-contact]').forEach((a) => {
  if (!links.whatsapp) return;
  a.href = links.whatsapp;
  a.target = '_blank';
  a.rel = 'noopener';
});

const show = (selector: string, href: string | null) =>
  document.querySelectorAll<HTMLAnchorElement>(selector).forEach((a) => {
    if (!href) return;
    a.href = href;
    a.hidden = false;
  });
show('[data-linkedin]', links.linkedin);
show('[data-email]', links.email);

const demo = demoHref(window.location.search);
document.querySelectorAll<HTMLAnchorElement>('[data-demo]').forEach((a) => (a.href = demo));
document
  .querySelectorAll<HTMLAnchorElement>('[data-login]')
  .forEach((a) => (a.href = config.loginUrl));
document
  .querySelectorAll('[data-year]')
  .forEach((el) => (el.textContent = String(new Date().getFullYear())));

const team = document.querySelector<HTMLElement>('[data-team]');
if (team) renderTeam(team, TEAM);
