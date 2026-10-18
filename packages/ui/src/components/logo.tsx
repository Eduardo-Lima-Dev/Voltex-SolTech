import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

/**
 * Marca PROVISÓRIA da Voltex SolTech (raio sobre sol). Substituir pelo logo oficial quando for entregue:
 * apps/web/src/assets, apps/web/public e docs/assets.
 */
export function LogoMark({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Voltex SolTech"
      className={cn('size-8', className)}
      {...props}
    >
      <circle cx="16" cy="16" r="14" fill="var(--primary)" />
      <path d="M18.5 5 9 18h6l-1.5 9L23 14h-6l1.5-9Z" fill="var(--primary-foreground)" />
    </svg>
  );
}

export function Logo({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <LogoMark />
      <span className="text-base font-semibold tracking-tight">
        Voltex <span className="font-normal opacity-80">SolTech</span>
      </span>
    </div>
  );
}
