import { ArrowLeft, ShieldCheck, Sun, TrendingUp, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@voltex/ui';
import { ThemeToggle } from '@/app/layout/theme-toggle';

const HIGHLIGHTS: { icon: LucideIcon; text: string }[] = [
  { icon: Sun, text: 'Do lead à proposta com premissas rastreáveis' },
  { icon: TrendingUp, text: 'Margem protegida antes de enviar ao cliente' },
  { icon: ShieldCheck, text: 'Triagem técnica e regulatória com revisão humana' },
];

const SITE_URL = import.meta.env.VITE_SITE_URL?.trim() || null;

/** Tela dividida das páginas públicas: painel de marca (azul-marinho) + formulário. */
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
        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">
              Inteligência comercial e técnica para integradores solares.
            </h2>
            <p className="text-brand-ice/80">
              Quatro produtos conectados em uma suíte: CRM, calculadora, engenharia e off-grid.
            </p>
          </div>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-sm leading-6 text-brand-ice/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-ice/60">
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
