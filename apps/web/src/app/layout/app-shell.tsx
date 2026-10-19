import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useMatches } from 'react-router';
import {
  Button,
  Logo,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@voltex/ui';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/** Casca da suíte: menu lateral (gaveta no celular), cabeçalho e área de conteúdo. */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = [...useMatches()]
    .reverse()
    .map((match) => (match.handle as { title?: string } | undefined)?.title)
    .find(Boolean);

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Pular para o conteúdo
      </a>

      <SidebarNav className="hidden lg:flex" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 max-w-[85vw] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">
                Navegação entre os produtos da suíte
              </SheetDescription>
              <SidebarNav className="w-full border-r-0" onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>

          <Logo className="h-7 lg:hidden" />
          {title ? (
            <p className="hidden text-sm font-medium text-muted-foreground lg:block">{title}</p>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="conteudo" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
