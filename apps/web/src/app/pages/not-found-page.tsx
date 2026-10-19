import { Link } from 'react-router';
import { Logo } from '@voltex/ui';
import '@/components/brand-motion.css';
import { SunArc } from '@/components/sun-arc';

/** Endereço que não existe. Mesmo visual do site e da tela de entrada. */
export function NotFoundPage() {
  return (
    <div className="relative flex min-h-dvh flex-col justify-between overflow-hidden bg-brand-navy p-6 text-brand-ice sm:p-12">
      <img
        src="/brand-grid-cyan.svg"
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 h-[38rem] w-auto opacity-[0.12]"
      />
      <SunArc />
      <Logo tone="on-dark" className="relative h-12 self-start" />

      <main className="relative max-w-2xl space-y-6 py-16">
        <p
          className="brand-mono brand-rise text-xs text-brand-cyan"
          style={{ ['--i' as string]: 0 }}
        >
          Erro 404
        </p>
        <h1
          className="brand-rise text-[clamp(2.4rem,6vw,4.2rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-balance"
          style={{ ['--i' as string]: 1 }}
        >
          Página não encontrada
        </h1>
        <p className="brand-rise max-w-md text-brand-ice/75" style={{ ['--i' as string]: 2 }}>
          O endereço que você tentou abrir não existe ou foi movido.
        </p>
        <Link
          to="/"
          className="brand-rise inline-flex h-11 items-center rounded-full bg-brand-cyan px-6 text-[0.95rem] font-semibold text-brand-navy outline-none transition-colors hover:bg-brand-cyan/85 focus-visible:ring-[3px] focus-visible:ring-brand-ice"
          style={{ ['--i' as string]: 3 }}
        >
          Voltar ao início
        </Link>
      </main>

      <p className="brand-mono relative text-[0.68rem] text-brand-ice/50">
        © {new Date().getFullYear()} Voltex SolTech
      </p>
    </div>
  );
}
