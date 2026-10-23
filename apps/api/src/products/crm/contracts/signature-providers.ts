import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import type { IntegrationAdapter } from '../../../platform/integrations/integration-adapter';
import { IntegrationRegistry } from '../../../platform/integrations/integration-registry';

/**
 * DocuSeal (assinatura eletrônica, AGPL, auto-hospedado). **Catalogado, sem adaptador**: da documentação pública não
 * deu para fechar os pontos de que o envio e o retorno dependem, e nada é presumido (ADR-0025):
 *  - posição dos campos de assinatura (`areas`: unidade das coordenadas) e se as tags `{{...}}` valem na edição livre;
 *  - se `POST /submissions/pdf` está na edição livre e o prefixo da API numa instância própria;
 *  - eventos de aviso (webhook) além de `form.completed` e como autenticar o recebimento (a documentação só cita um
 *    token na própria URL).
 * Enquanto isso, o caminho padrão continua sendo registrar o contrato já assinado (`POST /contracts/:id/sign`).
 */
export const DOCUSEAL_ADAPTER: IntegrationAdapter = {
  key: 'docuseal',
  kind: 'SIGNATURE',
  label: 'DocuSeal (assinatura eletrônica)',
  official: true,
  docsUrl: 'https://www.docuseal.com/docs/api',
  licenseStatus: 'PENDING_REVIEW',
  available: false,
  notes:
    'Falta validar numa instância real: posição dos campos de assinatura, endpoints da edição livre e a autenticação dos avisos (webhook). Antes de usar, obtenha parecer jurídico sobre a validade da assinatura. Por enquanto, registre o contrato assinado pelo caminho padrão.',
  credentialFields: [
    {
      name: 'baseUrl',
      label: 'Endereço da instância',
      secret: false,
      required: true,
      hint: 'Ex.: https://assinaturas.suaempresa.com.br',
    },
    { name: 'apiToken', label: 'Chave da API', secret: true, required: true, hint: null },
  ],
  credentialSchema: z.object({ baseUrl: z.url(), apiToken: z.string().min(8) }),
  minIntervalMinutes: 60,
  test: () =>
    Promise.resolve({
      ok: false,
      message:
        'Adaptador ainda não implementado: faltam validações numa instância real do DocuSeal. Use o registro manual do contrato assinado.',
    }),
};

/** Registra no Integration Hub os provedores de assinatura conhecidos. Todos nascem desligados no servidor. */
@Injectable()
export class SignatureRegistrar implements OnModuleInit {
  constructor(private readonly registry: IntegrationRegistry) {}

  onModuleInit(): void {
    this.registry.register(DOCUSEAL_ADAPTER);
  }
}
