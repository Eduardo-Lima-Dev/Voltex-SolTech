import '@fontsource-variable/jetbrains-mono';
import { ArrowLeft } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Logo } from '@voltex/ui';
import { ThemeToggle } from '@/app/layout/theme-toggle';
import './auth.css';

const HIGHLIGHTS = [
  'Do lead à proposta com premissas rastreáveis',
  'Margem protegida antes de enviar ao cliente',
  'Triagem técnica e regulatória com revisão humana',
];

const SITE_URL = import.meta.env.VITE_SITE_URL?.trim() || null;

const rise = (i: number): CSSProperties => ({ ['--i' as string]: i });

/** Tela dividida das páginas públicas: painel de marca (azul-marinho, como o site) + formulário. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-navy text-brand-ice lg:flex lg:flex-col lg:justify-between lg:p-12">
        <img
          src="/brand-grid-cyan.svg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-36 -right-44 h-[34rem] w-auto opacity-[0.13]"
        />
        <svg
          className="auth-arc pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 700 800"
          preserveAspectRatio="xMidYMin slice"
          aria-hidden
        >
          <path d="M0 200H700" stroke="rgb(140 221 244 / 0.18)" fill="none" />
          <path
            className="auth-arc-line"
            pathLength={1}
            d="M-40 200C160 200 260 40 440 40S690 200 760 200"
            fill="none"
            stroke="rgb(140 221 244 / 0.45)"
            strokeWidth="1.5"
          />
          <circle className="auth-sun" r="9" fill="rgb(140 221 244)" />
        </svg>

        {SITE_URL ? (
          <a
            href={SITE_URL}
            aria-label="Voltex SolTech — voltar ao site"
            className="relative self-start rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
          >
            <Logo tone="on-dark" className="h-12" />
          </a>
        ) : (
          <Logo tone="on-dark" className="relative h-12 self-start" />
        )}

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-5">
            <p className="auth-mono auth-rise text-xs text-brand-cyan" style={rise(0)}>
              Suíte para integradores fotovoltaicos
            </p>
            <h2
              className="auth-rise text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.04em] text-balance"
              style={rise(1)}
            >
              Venda mais projetos solares sem perder o fio do negócio.
            </h2>
            <p className="auth-rise max-w-md text-brand-ice/75" style={rise(2)}>
              CRM, calculadora, engenharia e off-grid: quatro produtos conectados em uma suíte.
            </p>
          </div>
          <ol className="border-t border-brand-ice/15">
            {HIGHLIGHTS.map((text, i) => (
              <li
                key={text}
                className="auth-rise flex items-baseline gap-4 border-b border-brand-ice/15 py-3.5"
                style={rise(3 + i)}
              >
                <span className="auth-mono text-xs text-brand-cyan">0{i + 1}</span>
                <span className="text-sm leading-6 text-brand-ice/90">{text}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="auth-mono relative text-[0.68rem] text-brand-ice/50">
          © {new Date().getFullYear()} Voltex SolTech
        </p>
      </aside>

      <main className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        {SITE_URL ? (
          <a
            href={SITE_URL}
            className="absolute left-4 top-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground sm:left-6 sm:top-6"
          >
            <ArrowLeft className="size-4" aria-hidden /> Voltar ao site
          </a>
        ) : null}
        <div className="absolute right-3 top-3 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>
        <Logo className="mb-8 h-10 lg:hidden" />
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
