import { Check, Minus } from 'lucide-react';
import { useState } from 'react';
import { ROLE_PERMISSIONS, Role, type Permission } from '@voltex/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@voltex/ui';
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  permissionsOfGroup,
} from '@/i18n/labels';

const ROLES = Object.values(Role);

/** Matriz de permissões por perfil (somente leitura): o que cada perfil pode fazer na suíte. */
export function RolesPage() {
  const [selected, setSelected] = useState<Role>('SALESPERSON');
  const granted = new Set<Permission>(ROLE_PERMISSIONS[selected]);

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Perfis</CardTitle>
          <CardDescription>Escolha um perfil para ver suas permissões.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1" aria-label="Perfis disponíveis">
            {ROLES.map((role) => (
              <li key={role}>
                <button
                  type="button"
                  onClick={() => setSelected(role)}
                  aria-pressed={selected === role}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    selected === role
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <span>{ROLE_LABELS[role]}</span>
                  <span
                    className={cn(
                      'text-xs',
                      selected === role ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {ROLE_PERMISSIONS[role].length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{ROLE_LABELS[selected]}</CardTitle>
            <Badge variant="secondary">{granted.size} permissões</Badge>
          </div>
          <CardDescription>{ROLE_DESCRIPTIONS[selected]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {PERMISSION_GROUPS.map((group) => {
            const permissions = permissionsOfGroup(group.prefix);
            const count = permissions.filter((p) => granted.has(p)).length;
            return (
              <section key={group.id} aria-labelledby={`grupo-${group.id}`}>
                <h3
                  id={`grupo-${group.id}`}
                  className="mb-2 flex items-center justify-between text-sm font-semibold"
                >
                  {group.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {count} de {permissions.length}
                  </span>
                </h3>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {permissions.map((permission) => {
                    const has = granted.has(permission);
                    return (
                      <li
                        key={permission}
                        className={cn(
                          'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm',
                          has ? '' : 'text-muted-foreground',
                        )}
                      >
                        {has ? (
                          <Check
                            className="mt-0.5 size-4 shrink-0 text-success"
                            aria-label="Permitido"
                          />
                        ) : (
                          <Minus
                            className="mt-0.5 size-4 shrink-0 opacity-50"
                            aria-label="Não permitido"
                          />
                        )}
                        <span>{PERMISSION_LABELS[permission]}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
