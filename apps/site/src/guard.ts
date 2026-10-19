import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const COST = 30_000;
const MIN_MARGIN = 0.2;
/** Fim da barra: 40% de margem. */
const SCALE = 0.4;

const brl = (value: number) => `R$ ${Math.round(value).toLocaleString('pt-BR')}`;

/** Margem de contribuição = (preço − custo) / preço. */
export const marginOf = (price: number, cost = COST): number => (price - cost) / price;

/** Simulação da margem protegida. Todos os números são de exemplo. */
export function initGuard(motion: boolean) {
  const root = document.querySelector<HTMLElement>('[data-guard]');
  const range = root?.querySelector<HTMLInputElement>('[data-range]');
  const fill = root?.querySelector<HTMLElement>('[data-fill]');
  const mark = root?.querySelector<HTMLElement>('[data-min]');
  const price = root?.querySelector<HTMLElement>('[data-price]');
  const margin = root?.querySelector<HTMLElement>('[data-margin]');
  const status = root?.querySelector<HTMLElement>('[data-status]');
  if (!root || !range || !fill || !mark || !price || !margin || !status) return;

  mark.style.left = `${(MIN_MARGIN / SCALE) * 100}%`;
  const render = (value: number) => {
    const m = marginOf(value);
    const blocked = m < MIN_MARGIN;
    price.textContent = brl(value);
    margin.textContent = `${(m * 100).toFixed(1).replace('.', ',')}%`;
    fill.style.width = `${Math.max(0, Math.min(100, (m / SCALE) * 100))}%`;
    status.classList.toggle('is-blocked', blocked);
    status.textContent = blocked
      ? 'Abaixo da margem mínima. A proposta trava e pede aprovação do gestor.'
      : 'Dentro da política. Pode enviar.';
  };
  range.addEventListener('input', () => {
    demo?.kill();
    render(Number(range.value));
  });
  render(Number(range.value));
  if (!motion) return;

  // Demonstra sozinho quando a seção aparece, até a pessoa mexer.
  const value = { v: Number(range.value) };
  const update = () => {
    range.value = String(Math.round(value.v / 500) * 500);
    render(Number(range.value));
  };
  const demo = gsap
    .timeline({ paused: true })
    .to(value, { v: 33_000, duration: 1.8, ease: 'power2.inOut', onUpdate: update }, 0.6)
    .to(value, { v: 40_000, duration: 1.8, ease: 'power2.inOut', onUpdate: update }, '+=1.4');
  ScrollTrigger.create({ trigger: root, start: 'top 70%', once: true, onEnter: () => demo.play() });
}
