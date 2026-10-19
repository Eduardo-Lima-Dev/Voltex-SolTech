import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * "O caminho de um negócio". Em telas largas a seção fica fixa e a rolagem troca o passo e o painel;
 * nas demais, os painéis aparecem dentro de cada passo, conforme a pessoa rola.
 */
export function initStory() {
  const root = document.querySelector<HTMLElement>('.story');
  if (!root) return;
  const steps = [...root.querySelectorAll<HTMLElement>('[data-step]')];
  const panels = steps.map((s) => s.querySelector<HTMLElement>('[data-panel]')!);
  const mm = gsap.matchMedia();

  mm.add('(min-width: 62rem) and (prefers-reduced-motion: no-preference)', () => {
    root.classList.add('is-pinned');
    gsap.set(panels, { autoAlpha: 0, yPercent: -50 });

    let current = -1;
    const show = (index: number) => {
      if (index === current) return;
      const leaving = panels[current];
      current = index;
      steps.forEach((s, i) => s.classList.toggle('is-active', i === index));
      if (leaving) gsap.to(leaving, { autoAlpha: 0, y: -24, duration: 0.25, overwrite: true });
      gsap.fromTo(
        panels[index]!,
        { autoAlpha: 0, y: 36 },
        { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power3.out', overwrite: true },
      );
    };
    show(0);

    const trigger = ScrollTrigger.create({
      trigger: '.story__pin',
      start: 'top top',
      end: () => `+=${steps.length * 65}%`,
      pin: true,
      anticipatePin: 1,
      onUpdate: (self) =>
        show(Math.min(steps.length - 1, Math.floor(self.progress * steps.length))),
    });
    return () => {
      trigger.kill();
      root.classList.remove('is-pinned');
      gsap.set(panels, { clearProps: 'all' });
      steps.forEach((s) => s.classList.remove('is-active'));
    };
  });

  mm.add('(max-width: 61.99rem), (prefers-reduced-motion: reduce)', () => {
    steps.forEach((s) => s.classList.remove('is-active'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    panels.forEach((panel) =>
      gsap.from(panel, {
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: panel, start: 'top 88%', once: true },
      }),
    );
  });
}
