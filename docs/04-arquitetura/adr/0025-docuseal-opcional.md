## Guia de Ativação (Adicional)

Antes de ativar DocuSeal em produção:

1. **Parecer jurídico:** Solicite ao seu advogado parecer sobre validade de assinatura eletrônica (Lei 2.200-2/2001, art. 10, §2º e Resolução CFP 12/2022 se houver contrato de services).

2. **Documentação de aprovação:** Arquive o parecer no seu processo de governança.

3. **Contêiner Docker:** Se optar por DocuSeal, use o profile Docker:

   ```bash
   docker-compose --profile docuseal up
   ```

   Postgres e S3 dedicados, versão livre.

4. **Credenciais:** Configure na plataforma (Integration Hub → DocuSeal).

5. **Teste em staging:** Antes de produção.

6. **Aviso ao cliente:** Deixe explícito que assinatura eletrônica é usada (contratos, documentos).

## Licença e Responsabilidade

- **DocuSeal:** AGPL 3.0 (gratuito, auto-hospedado).
- **Validade jurídica:** Responsabilidade do cliente (empresa + advogado).
- **Não há garantia** de que será válido em todos os estados/contextos. Cada caso é único.

Voltex não assume responsabilidade pela legalidade da assinatura. Seu advogado aprova ou não.
