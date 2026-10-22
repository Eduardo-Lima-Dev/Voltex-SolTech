# ADR-0021: App de campo offline (PWA) e sincronização só por acréscimo

- **Status:** Aceita (implementação a partir da Fase 11C)
- **Data:** 2026-10-22

## Contexto

O técnico trabalha em telhado e em zona rural, onde a internet cai. O app de campo precisa abrir, mostrar as ordens, registrar o que foi feito e enviar depois, sem perder nada e sem que o envio repetido faça coisa em dobro. Os dados ficam no aparelho do técnico, que pode ser pessoal ou compartilhado.

## Decisão

- **PWA na mesma aplicação web** (rota `/campo`, fora do menu da suíte): sem loja de aplicativos. Um **service worker escrito à mão** (`public/sw.js`) guarda a casca do app (página inicial e arquivos com hash em `/assets/`) para abrir sem internet. **A API nunca passa pelo cache**: o que o técnico precisa fica no IndexedDB, sob controle do app. O service worker é revalidado a cada visita e os caches de versões antigas são apagados. Foi preferido ao `vite-plugin-pwa` para não depender de compatibilidade com o Vite 8 e porque o precache de arquivos com hash é feito em tempo de execução.
- **Primeiro grava no aparelho, depois envia.** Toda ação (iniciar, marcar item, anotar, registrar pendência, concluir) vira um registro na fila do IndexedDB e é aplicada na cópia local da ordem na hora (a tela responde igual com ou sem internet). O envio é em lote, em ordem de ocorrência.
- **Sincronização só por acréscimo e idempotente.** Cada ação leva um `clientActionId` gerado no aparelho; o servidor guarda o resultado (`FieldAction`) e, se o mesmo id chegar de novo, devolve o resultado anterior sem repetir. Fotos e assinatura seguem o mesmo princípio (chave única por foto). **Nada que está no servidor é sobrescrito**: cada ação é validada contra o estado atual; o que não cabe (a ordem foi cancelada, o item saiu do checklist, o técnico saiu da escala) volta como **recusado**, com a mensagem, e a pessoa vê e dispensa. Alterações de checklist e anotações são feitas com a linha da ordem travada, para duas pessoas não se atropelarem.
- **Erro do servidor repete, erro do cliente recusa.** Falha de rede ou erro 5xx mantém tudo na fila e tenta de novo (ao voltar a conexão, ao reabrir a aba e a cada minuto). Erro 4xx do lote inteiro (formato) marca como recusado em vez de insistir para sempre. Sessão vencida (401) pára o envio sem perder nada e pede para entrar de novo.
- **Arquivos como bytes.** Fotos e assinaturas ficam no IndexedDB como `ArrayBuffer` (alguns navegadores móveis perdem `Blob`). A foto é reduzida (lado maior de 1920 px, JPEG) antes de guardar: economiza plano de dados e **descarta o EXIF**, inclusive a localização embutida pela câmera. A posição do GPS, quando a pessoa permite, vai como campo separado e só da ordem.
- **Sem sessão, com perfil.** O app guarda no aparelho só o nome e o id de quem usou (nunca o token). Sem internet e sem sessão ele abre com esse perfil e os dados do próprio técnico; para enviar é preciso entrar de novo. Cada registro leva o `userId`: no mesmo aparelho, cada pessoa vê e envia só o que é dela.
- **Escopo do técnico.** `ops.field.execute` age nas ordens em que está escalado (direto ou pela equipe); a operação (`ops.workorder.write`) age em qualquer uma. A checagem é do serviço.
- **Checklist definido por quem cria a ordem.** Não há lista técnica padrão no sistema: o conteúdo técnico (ex.: ensaios do comissionamento) vem de regra versionada com fonte e revisor (11D), nunca embutido no código.

## Consequências

- Dados pessoais de clientes (nome, endereço, telefone, fotos) ficam no aparelho do técnico até o envio e, nas ordens baixadas, até a próxima atualização. Há o botão **Limpar dados deste aparelho** (só sem pendências). A eliminação a pedido do titular e a retenção das fotos e posições no servidor entram na 11J, com o prazo confirmado com o advogado.
- Mais três tabelas (`work_order_photos`, `field_actions` e colunas de checklist, posição e assinatura na ordem).
- O offline cobre ler e registrar. Criar ordem, reagendar e cancelar continuam exigindo internet (são da operação).

## Alternativas consideradas

Aplicativo nativo (loja, duas bases de código); `vite-plugin-pwa` (dependência extra e risco de incompatibilidade); sincronização com resolução automática de conflitos por "última escrita vence" (esconde o conflito de quem estava em campo); guardar `Blob` no IndexedDB (falha em navegadores móveis); enviar fotos em base64 dentro do lote (lotes enormes e sem reenvio parcial).
