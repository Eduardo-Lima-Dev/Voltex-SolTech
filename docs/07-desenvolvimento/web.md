# Web (React)

`apps/web` — a "suíte": um único app React com a área de cada produto (CRM, Calculator, Engine, Off-Grid) e a administração, sob uma identidade visual só ([ADR-0002](../04-arquitetura/adr/0002-modular-monolith.md), [identidade visual](../00-visao-geral/identidade-visual.md)).

**Stack:** React 19 · Vite 8 · React Router 8 · TanStack Query 5 · react-hook-form + Zod · Tailwind 4 · `@voltex/ui` · Vitest + Testing Library + MSW.

Decisões do front: [ADR-0013](../04-arquitetura/adr/0013-arquitetura-do-front-end.md).

## Estrutura

```
apps/web/src/
├── main.tsx · index.css
├── app/                     # casca da aplicação
│   ├── providers.tsx        # tema → TanStack Query → autenticação → toasts
│   ├── router.tsx           # mapa de rotas (lazy por tela)
│   ├── guards.tsx           # RequireAuth · GuestOnly · RequirePermission · Can
│   ├── theme.tsx            # claro / escuro / sistema
│   ├── layout/              # AppShell, SidebarNav, ThemeToggle, UserMenu
│   └── pages/               # 404, sem acesso, erro de rota
├── features/
│   ├── auth/                # login, aceitar convite, AuthProvider, SessionStore
│   ├── dashboard/           # início da suíte
│   ├── products/            # registro dos 4 produtos + página "em desenvolvimento"
│   ├── calculator/          # Solar Calculator: lista, wizard, resultado, snapshots
│   └── admin/               # empresa, usuários/convites, perfis, auditoria,
│       └── reference/       #   tarifas, irradiação (CSV) e regras
├── lib/
│   ├── api/                 # ApiClient, endpoints tipados, erros
│   ├── query-client.ts
│   └── format.ts
├── i18n/labels.ts           # textos pt-BR de perfis, permissões, auditoria...
├── components/ · hooks/
└── test/                    # setup (MSW), fixtures, renderApp
```

## Solar Calculator (Fase 6)

- `form.ts` guarda o formulário como **texto** e converte só ao calcular (`buildInput`): vírgula decimal, R$ → centavos, % → fração. `evaluate` roda o **mesmo `calculateQuick` da API** com os limites de `GET /calculations/quick/config`; é o "resultado em tempo real" do wizard. Na hora de salvar o cliente envia só a entrada: o servidor recalcula e é a fonte oficial.
- `validateStep` só orienta o preenchimento por etapa; a validação oficial é a do motor/API.
- O resultado (`result-view.tsx`) é o mesmo componente no wizard (versão compacta), no cálculo salvo e no snapshot. Os gráficos (Recharts) ficam em `charts-section.tsx`, carregado sob demanda.
- Administração: `/admin/tarifas`, `/admin/irradiacao` (cadastro e importação de CSV lida no navegador, `admin/reference/csv.ts`) e `/admin/regras` (somente leitura). Edição exige `platform.rule.manage`.

## Rotas

| Rota                                            | Acesso                          | Tela                                                              |
| ----------------------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `/login`                                        | visitante                       | Login (logado é redirecionado)                                    |
| `/accept-invitation?token=…`                    | público                         | Criar conta a partir do convite                                   |
| `/`                                             | autenticado                     | Início: produtos da suíte e status dos serviços (administradores) |
| `/crm` · `/calculator` · `/engine` · `/offgrid` | permissão de leitura do produto | Página "em desenvolvimento" até a fase de cada produto            |
| `/admin/empresa`                                | `platform.tenant.manage`        | Dados da empresa, filiais e times                                 |
| `/admin/usuarios`                               | `platform.user.read`            | Usuários e convites                                               |
| `/admin/perfis`                                 | `platform.user.read`            | Matriz de permissões por perfil (somente leitura)                 |
| `/admin/auditoria`                              | `platform.audit.read`           | Registro de auditoria com antes/depois                            |
| `*`                                             | —                               | 404                                                               |

Depois do login o usuário volta à página que tentou abrir (só caminhos internos; `//host` é ignorado).

## Autenticação no navegador

- **Access token só em memória** (`SessionStore`). Nunca vai para `localStorage`.
- **Refresh token em cookie `httpOnly`**, invisível ao JavaScript. Ao abrir o app, `AuthProvider` restaura a sessão chamando `POST /auth/refresh`.
- **Dica de sessão** (`voltex:session` no `localStorage`): indica que este navegador já teve sessão. Sem ela o app vai direto ao login sem chamar o servidor (evita um 401 em toda visita). A dica **nunca concede acesso**; o servidor decide. Sem armazenamento disponível, o app tenta restaurar mesmo assim.
- **Renovação automática:** ao receber 401, o `ApiClient` renova a sessão (uma única renovação por vez, mesmo com várias requisições falhando juntas) e repete a requisição uma vez. Se a renovação falha, a sessão local termina e o usuário volta ao login.
- Logout encerra a sessão local e limpa o cache **mesmo se o servidor estiver fora do ar**.

## Permissões na interface

A interface só **esconde** o que a API recusaria; **a API é a barreira real**.

```tsx
const { can, canAny } = useAuth();
can('platform.user.manage');                 // todas as permissões
<Can permission="platform.user.manage">…</Can>
<RequirePermission anyOf={['platform.audit.read']}><AuditPage /></RequirePermission>
```

A mesma política de perfis da API (`canManageRole`, em `@voltex/shared`) decide quais ações aparecem: ADMIN não vê botões de edição na linha de um OWNER, e ninguém edita a si mesmo.

## Falando com a API

`lib/api/endpoints.ts` concentra as chamadas, tipadas com os contratos de `@voltex/shared` (schemas Zod, tipos de resposta e `ROUTES`).

```ts
const { data } = useQuery({ queryKey: queryKeys.branches, queryFn: endpoints.branches.list });
const mutation = useMutation({
  mutationFn: endpoints.teams.create,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
  onError: (error) => toast.error(errorMessage(error)),
});
```

- Mensagens de erro: `errorMessage(error)`; erros de validação (422) por campo: `fieldErrors(error)`.
- Por padrão o front chama **`/api/v1` na própria origem**: em desenvolvimento o Vite encaminha `/api` para a API (porta de `API_PORT`), sem CORS e com o cookie de sessão funcionando. Para apontar para outro endereço, defina `VITE_API_URL`.
- Mensagens de validação do Zod saem em português do Brasil (`z.locales.ptBR()`), no front e na API.

## Tema e marca

Claro, escuro ou automático (segue o sistema), lembrado por navegador; aplicado antes da primeira pintura para não piscar. A barra lateral é **sempre azul-marinho** (marca). Detalhes em [identidade visual](../00-visao-geral/identidade-visual.md).

## Acessibilidade

- Link "Pular para o conteúdo", landmarks (`navigation`, `main`), títulos semânticos (`h1` na página, `h3` nos cards), foco visível e rótulos em todos os campos.
- Erros de formulário com `role="alert"` e `aria-invalid`; botões de ícone com `aria-label`.
- Respeita `prefers-reduced-motion`. Layout responsivo (menu em gaveta no celular, sem rolagem horizontal da página).
- Contraste WCAG AA verificado por teste nos dois temas.

## Testes

```bash
pnpm --filter @voltex/web test
```

Vitest + Testing Library + **MSW**: a API é simulada na camada de rede, então os testes exercitam o `fetch` real do `ApiClient`. Qualquer requisição **sem handler faz o teste falhar** (não só a requisição), o que evita chamadas esquecidas. Helpers: `renderApp(path, { session })` renderiza o app inteiro com as rotas reais e a sessão escolhida; `makeSession(role)` cria uma sessão com as permissões reais do perfil.

Cobertura: cliente HTTP (renovação em voo único, erros, rede), sessão e `AuthProvider` (StrictMode, logout offline), rotas e permissões por perfil, login, convite, painel, empresa/filiais/times, usuários e convites (filtros, paginação, edição, exclusão, escalada de privilégio), perfis, auditoria, tema, rótulos pt-BR (nenhum código cru na tela), formatação e paginação; Solar Calculator (lista, wizard com validação por etapa e resultado em tempo real, salvar com referências, detalhe, snapshots, permissões por perfil) e administração de tarifas, irradiação (inclusive importação de CSV) e regras.

Além dos testes automatizados, a interface foi percorrida num navegador real (Chromium via Playwright) contra a API de verdade: login/erros, tema escuro, sessão após recarregar, administração, convite de ponta a ponta, perfil sem acesso, logout, 404 e celular. A Fase 6 foi percorrida do mesmo modo (login → wizard → resultado com gráficos → snapshot → administração, no claro, no escuro e a 390 px, sem erro de console nem rolagem horizontal). Esse roteiro vira teste e2e automatizado na Fase 8. Roteiro para você repetir: [verificação manual](verificacao-manual.md).

## Adicionando uma tela

1. Rota em `app/router.tsx` com `lazy` e `handle.title`; proteja com `RequirePermission`.
2. Chamadas em `lib/api/endpoints.ts` (com tipos do `@voltex/shared`) e chaves em `query-keys.ts`.
3. Formulário com `react-hook-form` + `zodResolver` (reaproveite o schema de `@voltex/shared`).
4. Textos de enumerações em `i18n/labels.ts`.
5. Teste com `renderApp` cobrindo sucesso, erro da API e o que o perfil sem permissão **não** vê.
