import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

/** Cabeçalho: ganha fundo ao rolar e se esconde ao descer (volta ao subir). */
export function initHeader() {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  let last = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-solid', y > 40);
    header.classList.toggle('is-hidden', y > last && y > 480);
    last = y;
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/** Títulos das seções entram linha a linha; os blocos de lista, em sequência. */
export function initReveals() {
  document.querySelectorAll<HTMLElement>('main .h2').forEach((el) => {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 105,
          duration: 0.9,
          stagger: 0.08,
          ease: 'power4.out',
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        }),
    });
  });

  const groups: [string, string][] = [
    ['.plist', '.prow'],
    ['.flist', ':scope > div'],
    ['.tlist', 'li'],
    ['.acc', 'details'],
  ];
  for (const [group, item] of groups) {
    const root = document.querySelector<HTMLElement>(group);
    if (!root) continue;
    gsap.from(root.querySelectorAll(item), {
      y: 28,
      opacity: 0,
      duration: 0.8,
      stagger: 0.09,
      ease: 'power3.out',
      scrollTrigger: { trigger: root, start: 'top 82%', once: true },
    });
  }
  gsap.from('.margin .lead, .contact .lead', {
    y: 20,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: { trigger: '.margin, .contact', start: 'top 70%', once: true },
  });
}

/** Resposta da dúvida abre com altura animada. */
export function initFaq() {
  document.querySelectorAll<HTMLDetailsElement>('.acc details').forEach((item) => {
    item.addEventListener('toggle', () => {
      const answer = item.querySelector('p');
      if (item.open && answer)
        gsap.from(answer, {
          height: 0,
          opacity: 0,
          duration: 0.4,
          ease: 'power2.out',
          clearProps: 'height,opacity',
        });
    });
  });
}

/** Botões principais seguem de leve o ponteiro (só com mouse). */
export function initMagnet() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.querySelectorAll<HTMLElement>('[data-magnet]').forEach((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3' });
    const y = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3' });
    el.addEventListener('pointermove', (e) => {
      const box = el.getBoundingClientRect();
      x((e.clientX - (box.left + box.width / 2)) * 0.25);
      y((e.clientY - (box.top + box.height / 2)) * 0.35);
    });
    el.addEventListener('pointerleave', () => {
      x(0);
      y(0);
    });
  });
}
