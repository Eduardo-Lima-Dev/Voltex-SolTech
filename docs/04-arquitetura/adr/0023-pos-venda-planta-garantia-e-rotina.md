# ADR-0023: Pós-venda com planta, garantia por termo do fabricante e rotina configurada pela empresa

- **Status:** Aceita (implementação a partir da Fase 11E)
- **Data:** 2026-10-22

## Contexto

Depois do aceite do cliente o sistema precisa acompanhar a planta: equipamentos instalados, garantias, chamados, manutenção preventiva e contratos de O&M. Quase tudo aqui depende de **prazos que não são do sistema**: o prazo de cada garantia é do fabricante, a periodicidade da manutenção e o prazo de atendimento são da empresa, e o gatilho de expansão é uma decisão comercial. Embutir qualquer um desses números seria inventar regra de negócio.

## Decisão

- **A planta nasce do aceite.** O evento `CustomerAccepted` cria a `Plant` (idempotente, uma por instalação), com os ativos da lista de materiais recebida e a geração esperada do projeto técnico aprovado. Há uma conciliação manual para instalações aceitas antes da fase.
- **Garantia vem do termo do fabricante, cadastrado pela empresa** (`ManufacturerWarrantyTerm`): prazos de produto e de desempenho, percentual de potência ao fim e **fonte obrigatória** (documento, página ou link). O termo vale para os ativos novos; um termo novo encerra o anterior sem alterar garantias já calculadas. **Ativo sem termo fica como "garantia não cadastrada"**, e a garantia manual (datas informadas) é sempre possível. O sistema não traz prazo de fabricante nenhum.
- **Prazos e gatilhos são configuração da empresa** (`tenant.settings.operations`) e **não têm valor padrão**: janela de aviso de garantia, aviso de renovação de O&M, antecedência da manutenção, prazo de atendimento por prioridade e o gatilho de expansão (consumo médio da rede acima de X kWh/mês nas últimas N faturas validadas). Campo em branco desliga o recurso correspondente, e o painel mostra "não configurado" em vez de um número presumido.
- **Rotina periódica idempotente** (fila `aftersales`, BullMQ, `AFTERSALES_SCAN_INTERVAL_MS`, 0 desliga; também executável sob demanda): abre chamado e ordem de serviço do plano preventivo vencido, avisa garantia na janela, encerra ou renova contrato de O&M vencido, avisa renovação e abre oportunidade no CRM, e detecta a expansão. Cada ação tem chave de automação, então repetir a rotina não duplica nada.
- **Chamados** têm SLA calculado só quando há prazo configurado para a prioridade; o relógio **pausa** enquanto o chamado aguarda o cliente. Resolver exige a descrição da solução. Ativo substituído é histórico e não se edita.
- **O&M é registro**: valores de contrato e MRR são informados à mão; o sistema não cobra nem concilia pagamento (decisão do usuário, sem gateway).
- **Dados da planta entram na exportação da empresa** (`exportTenant`) e todos os modelos são escopados por `tenantId`.

## Consequências

- Enquanto a empresa não cadastrar os termos e as janelas, o pós-venda funciona como registro (plantas, ativos, chamados) e **não dispara nenhum aviso automático**: é a trava pretendida, e a tela deixa a pendência visível.
- Alerta de desempenho e monitoramento entram na 11F e reaproveitam `Ticket` (tipo `PERFORMANCE_ALERT`).
- O portal do cliente (11H) lê os chamados e as garantias já existentes; comentários internos não aparecem para o cliente.

## Alternativas consideradas

Prazos de garantia padrão por categoria (inventa termo de fabricante); periodicidade de manutenção e SLA padrão (decisão da empresa); alertas por e-mail direto da rotina (a tarefa e o evento bastam, o canal é escolha do usuário); planta criada na assinatura do contrato (ainda não há equipamento instalado nem aceite).
