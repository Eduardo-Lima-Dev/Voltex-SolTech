# App de campo offline (Fase 11C)

Decisão em [ADR-0021](../04-arquitetura/adr/0021-campo-offline-pwa.md). Tela em `/campo` (instalável como app pelo navegador; o manifesto traz o atalho **App de campo**). Para o instalador, **Operação → App de campo** leva até ela.

## O que o técnico faz

| Na tela da ordem          | O que acontece                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Iniciar**               | A ordem passa a "em execução" na hora; vai ao servidor com a posição do GPS (se permitida). Em instalação, a instalação passa a "em instalação" |
| **Checklist**             | Marca e desmarca itens (definidos por quem criou a ordem)                                                                                       |
| **Foto**                  | Abre a câmera (ou a galeria), reduz a imagem e guarda; sobe quando houver internet                                                              |
| **Pendência**             | Registra o impedimento (acesso, segurança, material…); se bloquear, a instalação pára                                                           |
| **Anotação**              | Acrescenta uma linha com data e autor às notas da ordem                                                                                         |
| **Assinatura do cliente** | Desenho na tela + nome de quem assina; só com a ordem em execução ou concluída                                                                  |
| **Concluir**              | Fecha a ordem; com pendência bloqueante o servidor recusa e a tela explica                                                                      |

Há também o atalho para abrir o endereço no mapa e para ligar ao contato.

## Sem internet

- O cabeçalho mostra **Sem internet** e quantos itens esperam envio. Tudo continua funcionando; as ordens vêm da última atualização.
- Ao voltar a conexão (ou ao reabrir a aba, ou a cada minuto) o aparelho **envia sozinho**, na ordem em que as coisas aconteceram, e depois atualiza as ordens. O botão de sincronizar força o envio.
- Se o servidor **recusar** algo (ordem cancelada, item removido, técnico fora da escala), a ordem mostra o cartão **O sistema recusou algo** com a mensagem. A recusa não é reenviada; **Entendi** a tira da lista.
- Se a **sessão vencer**, o app abre com o perfil guardado e avisa para **Entrar** de novo; nada se perde, e o envio recomeça depois do login.
- Reabrir o navegador sem internet funciona depois da primeira visita online (o service worker guarda a casca do app; o IndexedDB, as ordens).

## Para a operação

- O **checklist** é definido ao criar ou editar a ordem (`checklist: ["item", …]`); trocar a lista mantém o estado dos itens que continuam. O sistema não traz lista técnica pronta.
- **Fotos:** `GET /operations/work-orders/:id/photos` lista (links temporários); `PATCH /operations/photos/:id` define legenda e se o **cliente pode ver** (usado pelo portal, 11H).
- **Posição e assinatura** ficam na ordem (`geo`, `signedByName`, `signedAt`) e a imagem da assinatura é um documento versionado.

## API

| Rota                                               | Para quê                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /operations/field/work-orders`                | Ordens do técnico com local, contato, pendências abertas e fotos (a cópia que o app guarda)                                  |
| `POST /operations/field/sync`                      | Lote de ações `START`, `COMPLETE`, `CHECK`, `NOTE`, `ISSUE` (até 100). Cada uma devolve `APPLIED`, `DUPLICATE` ou `REJECTED` |
| `POST /operations/field/work-orders/:id/photos`    | Foto (multipart: `file`, `clientActionId`, `caption`, `takenAt`, `latitude`, `longitude`, `accuracy`)                        |
| `POST /operations/field/work-orders/:id/signature` | Assinatura PNG + `signedByName` + `clientActionId`                                                                           |

Reenviar o mesmo `clientActionId` nunca repete a ação. Limite de 60 fotos por ordem.

## Detalhes técnicos

- `apps/web/src/features/field/`: `field-engine.ts` (fila, envio, recusas), `field-db.ts` (IndexedDB), `field-local.ts` (efeito local das ações), `field-provider.tsx` (sessão, conexão, perfil), `signature-pad.tsx`, `media.ts` (compressão e GPS).
- `apps/web/public/sw.js`: casca do app e `/assets/` em cache; `/api/` nunca. Registrado só em produção (`lib/register-sw.ts`). O nginx e o template da Vercel servem `sw.js` sem cache.
- Cada registro no aparelho leva o `userId`: no mesmo aparelho cada pessoa vê e envia só o que é dela. **Limpar dados deste aparelho** só vale sem pendências.

## Testes

`apps/api/test/field.e2e.test.ts` (18 casos: lote, idempotência, recusas, instalação real, fotos, assinatura, isolamento), `field-engine.test.ts`, `field-local.test.ts` e `field.test.tsx` (interface, inclusive offline e perfil sem sessão).

## Limites desta fase

- A posição só vai no início e na conclusão da ordem e nas fotos; não há rastreamento contínuo nem rota.
- O service worker guarda a casca no primeiro acesso online; a primeira abertura sem nenhuma visita prévia não funciona.
- A imagem da assinatura não tem valor de assinatura eletrônica: é um registro de conferência em campo (a assinatura de contrato é outro assunto, 11I).
- Verificação em aparelho real (câmera, GPS, instalação como app) depende de um celular: ver o roteiro em [verificação manual](verificacao-manual.md).
- Retenção e eliminação das fotos e posições no servidor: 11J.
