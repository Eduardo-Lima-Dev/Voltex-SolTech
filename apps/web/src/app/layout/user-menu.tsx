import { LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from '@voltex/ui';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initialsOf,
} from '@voltex/ui';
import { useCurrentUser, useAuth } from '@/features/auth/auth-provider';
import { roleLabel } from '@/i18n/labels';

export function UserMenu() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      toast.error(
        'Não foi possível encerrar a sessão por completo, mas você foi desconectado neste aparelho.',
      );
    }
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Menu do usuário ${user.name}`}
        >
          <Avatar>
            <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">
            {roleLabel(user.role)} · {user.tenantName}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/conta/seguranca')}>
          <ShieldCheck />
          Segurança da conta
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleLogout()}>
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
