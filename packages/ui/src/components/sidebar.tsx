import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '../lib/utils';

/**
 * Barra lateral da suíte (navegação entre os produtos e suas seções).
 * Estilizada com os tokens `sidebar-*`; não depende de estado global.
 */
export function Sidebar({ className, ...props }: ComponentProps<'aside'>) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        'flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn('flex items-center gap-2 border-b border-sidebar-border p-4', className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3', className)}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('border-t border-sidebar-border p-3', className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-group" className={cn('flex flex-col gap-1', className)} {...props} />
  );
}

export function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'px-2 py-1 text-xs font-medium uppercase tracking-wide text-sidebar-muted',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-1', className)} {...props} />
  );
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('list-none', className)} {...props} />;
}

export function SidebarMenuButton({
  className,
  asChild = false,
  isActive = false,
  ...props
}: ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-primary data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-primary [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}
