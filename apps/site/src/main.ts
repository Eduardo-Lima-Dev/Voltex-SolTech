import './styles.css';
import { gsap } from 'gsap';
import { config } from './config';
import { initForm } from './form';
import { initGuard } from './guard';
import { initHero } from './hero';
import { initFaq, initHeader, initMagnet, initReveals } from './page';
import { initStory } from './story';

// Os botões "Entrar" levam à aplicação, que fica em outro endereço.
document
  .querySelectorAll<HTMLAnchorElement>('[data-login]')
  .forEach((a) => (a.href = config.loginUrl));
document
  .querySelectorAll('[data-year]')
  .forEach((el) => (el.textContent = String(new Date().getFullYear())));

const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

initHeader();
initForm();
initGuard(motion);
initStory();
initFaq();
void document.fonts.ready.then(() => {
  initHero(motion);
  if (motion) {
    initReveals();
    initMagnet();
  }
  gsap.ticker.lagSmoothing(0);
});
