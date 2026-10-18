# Identidade visual

A marca Voltex SolTech nasce do logo oficial (`docs/assets/brand/voltex-soltech-logo-original.svg`): um "V" estilizado em forma de asas e o nome em duas camadas — **VOLTEX** em gelo e **SolTech** em ciano — sobre azul-marinho. As **três cores do logo são a base de toda a interface**.

![Logo Voltex SolTech](../assets/brand/logo-banner.png)

## Cores base

| Cor              | Hex       | OKLCH                      | Papel                                                                      |
| ---------------- | --------- | -------------------------- | -------------------------------------------------------------------------- |
| **Azul-marinho** | `#002362` | `oklch(0.281 0.119 260.6)` | Cor principal: fundo da barra lateral, botões primários, texto             |
| **Ciano**        | `#8CDDF4` | `oklch(0.854 0.085 217.8)` | Destaque: item ativo, links em fundo escuro, botão primário no tema escuro |
| **Gelo**         | `#E3EBF0` | `oklch(0.935 0.011 234.8)` | Texto sobre marinho, superfícies secundárias                               |

**Cor derivada — ciano forte** `#007A96` (`oklch(0.53 0.11 217.8)`): o ciano da marca tem só 1,5:1 de contraste sobre branco, então não serve como texto ou ícone em fundo claro. O ciano forte mantém a **mesma matiz** e chega a 5:1 sobre branco e 4,6:1 sobre o fundo da página. Use-o no lugar do ciano em superfícies claras.

As cores semânticas do semáforo de pré-viabilidade (verde, amarelo, vermelho) **não** fazem parte da marca: são sinais de estado e seguem convenção universal.

## Como a paleta vira tema

Os tokens ficam em `packages/ui/src/styles.css` (Tailwind 4) e são derivados das cores acima:

| Token                          | Tema claro                                       | Tema escuro           |
| ------------------------------ | ------------------------------------------------ | --------------------- |
| `background`                   | gelo muito clarificado                           | marinho profundo      |
| `foreground`, `primary`        | azul-marinho                                     | gelo / ciano          |
| `secondary`                    | gelo                                             | marinho médio         |
| `accent`                       | tinta de ciano                                   | tinta de ciano escura |
| `ring` (foco)                  | ciano forte                                      | ciano                 |
| `sidebar`                      | **azul-marinho**                                 | marinho mais escuro   |
| `sidebar-primary` (item ativo) | **ciano**                                        | ciano                 |
| `chart-1…5`                    | marinho, ciano forte, ciano, azul, cinza-azulado | variantes claras      |

Classes utilitárias das cores puras: `bg-brand-navy`, `text-brand-cyan`, `bg-brand-ice`, `text-brand-cyan-strong`. Em código TypeScript use `BRAND_COLORS` de `@voltex/ui`.

### Acessibilidade

Todo par texto/fundo dos dois temas tem contraste **≥ 4,5:1** (WCAG AA) e o anel de foco ≥ 3:1. Isso é **verificado automaticamente** por `packages/ui/src/theme.test.ts`, que também garante que os tokens derivam exatamente dos hex do logo: alterar uma cor sem querer quebra o teste.

## Arquivos de marca (`docs/assets/brand/`)

| Arquivo                                                      | Uso                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `voltex-soltech-logo-original.svg`                           | Original recebido (com fundo marinho). Fonte para a geração dos demais |
| `logo-horizontal.svg` / `.png`                               | Símbolo + nome, fundo transparente, para fundos **escuros**            |
| `logo-horizontal-on-light.svg`                               | Marinho + ciano forte, para fundos **claros**                          |
| `logo-mark.svg` · `logo-mark-on-light.svg`                   | Só o símbolo "V"                                                       |
| `logo-banner.svg` / `.png`                                   | Logo sobre marinho (README, apresentações, pré-visualização de links)  |
| `favicon.svg`, `favicon-32.png`                              | Ícone do navegador                                                     |
| `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` | Ícones de aplicativo/PWA                                               |

Todos são **gerados** por `node scripts/build-brand-assets.mjs` a partir do original (os PNGs exigem `rsvg-convert`). O mesmo script produz `packages/ui/src/assets/logo-paths.ts`, usado pelo componente React. Se o logo mudar, substitua o original e rode o script.

O original desenha o miolo das letras O, o e e com formas azul-marinho por cima. O script as funde às letras com `fill-rule: evenodd`, criando **cortes reais**: assim o logo funciona sobre qualquer fundo, não só sobre marinho.

## No código

```tsx
import { Logo, LogoMark } from '@voltex/ui';

<Logo />                         {/* segue o tema: marinho no claro, gelo no escuro */}
<Logo tone="on-dark" />          {/* cores exatas da marca, p/ barra lateral marinho */}
<Logo tone="on-light" />         {/* marinho + ciano forte, p/ fundos claros fixos */}
<LogoMark className="size-8" />  {/* só o símbolo */}
<Logo title="" />                {/* decorativo (esconde do leitor de tela) */}
```

O componente é um `<svg>` com `role="img"` e `aria-label="Voltex SolTech"`. Defina o tamanho pela altura (`h-8`, `h-10`); a largura acompanha a proporção.

## Regras de uso

- **Fundo escuro** → logo em gelo + ciano. **Fundo claro** → logo em marinho + ciano forte. Nunca ciano puro sobre branco.
- **Área de respiro:** ao menos a altura da letra "O" do nome, em todos os lados.
- **Tamanho mínimo:** 120 px de largura para o logo completo; 24 px de largura para o símbolo.
- Não distorcer, girar, aplicar sombra/brilho, trocar as cores por outras fora desta paleta nem separar "VOLTEX" de "SolTech".
- A barra lateral é sempre azul-marinho (nos dois temas), com o logo em `tone="on-dark"`.
- Fonte da interface: **Inter** (Variable). O nome no logo é desenho (curvas), não uma fonte instalável.
