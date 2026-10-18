import type { ComponentProps } from 'react';
import { BRAND_COLORS } from '../brand';
import { LOGO_PATHS, LOGO_VIEWBOX } from '../assets/logo-paths';
import { cn } from '../lib/utils';

/**
 * Tom do logo:
 * - `auto` (padrão): segue o tema (marinho + ciano forte no claro; gelo + ciano no escuro) via `--logo-primary` e `--logo-accent`.
 * - `on-dark`: cores exatas da marca, para fundos escuros fixos (ex.: barra lateral azul-marinho).
 * - `on-light`: marinho + ciano forte, para fundos claros fixos.
 */
export type LogoTone = 'auto' | 'on-dark' | 'on-light';

const TONES: Record<LogoTone, { primary: string; accent: string }> = {
  auto: { primary: 'var(--logo-primary)', accent: 'var(--logo-accent)' },
  'on-dark': { primary: BRAND_COLORS.ice, accent: BRAND_COLORS.cyan },
  'on-light': { primary: BRAND_COLORS.navy, accent: BRAND_COLORS.cyanStrong },
};

export interface LogoProps extends Omit<ComponentProps<'svg'>, 'viewBox'> {
  tone?: LogoTone;
  /** Texto alternativo; use `''` quando o logo for puramente decorativo. */
  title?: string;
}

function LogoSvg({
  paths,
  viewBox,
  tone = 'auto',
  title = 'Voltex SolTech',
  className,
  ...props
}: LogoProps & {
  paths: readonly { primary: readonly string[]; accent: readonly string[] }[];
  viewBox: string;
}) {
  const colors = TONES[tone];
  const decorative = title === '';
  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      className={className}
      {...props}
    >
      {paths.map((group, index) => (
        <g key={index}>
          {group.primary.map((d, i) => (
            <path key={`p${i}`} d={d} fill={colors.primary} fillRule="evenodd" />
          ))}
          {group.accent.map((d, i) => (
            <path key={`a${i}`} d={d} fill={colors.accent} fillRule="evenodd" />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Símbolo "V" da Voltex SolTech (sem o nome). Proporção ~1,32:1. */
export function LogoMark({ className, ...props }: LogoProps) {
  return (
    <LogoSvg
      paths={[LOGO_PATHS.mark]}
      viewBox={LOGO_VIEWBOX.mark}
      className={cn('h-8 w-auto', className)}
      {...props}
    />
  );
}

/** Logo completo (símbolo + VOLTEX SolTech). Proporção ~3,1:1. Largura mínima recomendada: 120 px. */
export function Logo({ className, ...props }: LogoProps) {
  return (
    <LogoSvg
      paths={[LOGO_PATHS.mark, LOGO_PATHS.word]}
      viewBox={LOGO_VIEWBOX.full}
      className={cn('h-8 w-auto', className)}
      {...props}
    />
  );
}
