import { gsap } from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(DrawSVGPlugin, Flip, ScrollTrigger, SplitText);

/** Traça o arco do sol e as marcas de hora; o ponto luminoso percorre o arco na abertura e acompanha a rolagem. */
function sunArc(animate: boolean) {
  const path = document.querySelector<SVGPathElement>('#sunPath');
  const sun = document.querySelector<SVGCircleElement>('.hero__sun');
  const ticks = document.querySelector<SVGGElement>('.hero__ticks');
  if (!path || !sun || !ticks) return;

  const length = path.getTotalLength();
  const NS = 'http://www.w3.org/2000/svg';
  for (let i = 1; i < 24; i++) {
    const at = (i / 24) * length;
    const p = path.getPointAtLength(at);
    const q = path.getPointAtLength(Math.min(length, at + 1));
    const angle = Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2;
    const size = i % 6 === 0 ? 14 : 7;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(p.x - Math.cos(angle) * size));
    line.setAttribute('y1', String(p.y - Math.sin(angle) * size));
    line.setAttribute('x2', String(p.x + Math.cos(angle) * size));
    line.setAttribute('y2', String(p.y + Math.sin(angle) * size));
    ticks.appendChild(line);
  }

  const state = { t: 0.42 };
  const place = () => {
    const point = path.getPointAtLength(state.t * length);
    sun.setAttribute('cx', String(point.x));
    sun.setAttribute('cy', String(point.y));
  };
  place();
  if (!animate) return;

  gsap.set(path, { drawSVG: '0%' });
  gsap.set(ticks.children, { opacity: 0 });
  state.t = 0.04;
  place();
  const intro = gsap.timeline({ delay: 0.15 });
  intro
    .to(path, { drawSVG: '100%', duration: 2.4, ease: 'power2.inOut' }, 0)
    .to(state, { t: 0.42, duration: 2.4, ease: 'power2.inOut', onUpdate: place }, 0)
    .to(ticks.children, { opacity: 1, duration: 0.6, stagger: 0.04 }, 0.6);
  gsap.to(state, {
    t: 0.72,
    ease: 'none',
    onUpdate: place,
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });
}

function title(animate: boolean) {
  const el = document.querySelector<HTMLElement>('[data-split]');
  if (!el || !animate) return;
  SplitText.create(el, {
    type: 'lines',
    mask: 'lines',
    autoSplit: true,
    onSplit: (self) =>
      gsap.from(self.lines, {
        yPercent: 110,
        duration: 1.1,
        stagger: 0.09,
        ease: 'power4.out',
        delay: 0.2,
      }),
  });
  gsap.from('.hero [data-reveal]', {
    y: 24,
    opacity: 0,
    duration: 0.9,
    stagger: 0.12,
    ease: 'power3.out',
    delay: 0.7,
  });
  gsap.from('[data-board]', { y: 50, opacity: 0, duration: 1.2, ease: 'power3.out', delay: 0.5 });
}

const brl = (cents: number) => `R$ ${cents.toLocaleString('pt-BR')}`;

/** Quadro de exemplo: um cartão muda de coluna sozinho e os totais acompanham. Valores ilustrativos. */
function board() {
  const root = document.querySelector<HTMLElement>('[data-board]');
  const mover = root?.querySelector<HTMLElement>('[data-mover]');
  const from = root?.querySelector<HTMLElement>('[data-col="cot"]');
  const to = root?.querySelector<HTMLElement>('[data-col="prop"]');
  if (!root || !mover || !from || !to) return;

  const setTotals = (col: HTMLElement, count: number, total: number) => {
    col.querySelector('[data-n]')!.textContent = String(count);
    col.querySelector('[data-v]')!.textContent = brl(total);
    const sum = col.querySelector('.col__sum')!;
    sum.childNodes[1]!.textContent = count === 1 ? ' oportunidade · ' : ' oportunidades · ';
  };
  const place = (target: HTMLElement) => {
    const state = Flip.getState(mover);
    target.appendChild(mover);
    Flip.from(state, { duration: 0.9, ease: 'power3.inOut' });
    gsap.fromTo(
      mover,
      { scale: 1.05, boxShadow: '0 18px 30px rgba(0,0,0,.45)' },
      { scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)', duration: 0.9, delay: 0.5 },
    );
  };

  let forward = true;
  const step = () => {
    if (document.hidden) return void gsap.delayedCall(1, step);
    if (forward) {
      place(to);
      setTotals(from, 1, 37100);
      setTotals(to, 2, 43100);
    } else {
      place(from);
      setTotals(from, 2, 61900);
      setTotals(to, 1, 18300);
    }
    forward = !forward;
    gsap.delayedCall(3.4, step);
  };
  gsap.delayedCall(3, step);
}

export function initHero(motion: boolean) {
  sunArc(motion);
  title(motion);
  if (motion) board();
}
