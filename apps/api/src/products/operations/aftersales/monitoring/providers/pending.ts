import { z } from 'zod';
import type { IntegrationCredentialFieldDto } from '@voltex/shared';
import type { MonitoringProvider } from './types';

/**
 * Provedores catalogados, mas SEM adaptador: a documentação técnica não é pública (exige login, contrato ou NDA) ou
 * não pôde ser verificada. Nenhum endpoint é presumido. Ao receber a documentação oficial do provedor, o adaptador
 * entra como os de `solaredge.ts`/`apsystems.ts`/`fronius.ts`. Enquanto isso, a importação por planilha cobre qualquer marca.
 */
const field = (
  name: string,
  label: string,
  secret = false,
  hint: string | null = null,
  required = true,
): IntegrationCredentialFieldDto => ({ name, label, secret, required, hint });

interface PendingSpec {
  key: string;
  label: string;
  official: boolean;
  docsUrl?: string;
  notes: string;
  fields: IntegrationCredentialFieldDto[];
}

const PENDING_MESSAGE =
  'Adaptador ainda não implementado (falta a documentação técnica do provedor). Use a importação por planilha.';

function pending(spec: PendingSpec): MonitoringProvider {
  const shape: Record<string, z.ZodType<string>> = {};
  for (const f of spec.fields)
    shape[f.name] = f.required ? z.string().min(1) : z.string().optional().default('');
  return {
    key: spec.key,
    label: spec.label,
    official: spec.official,
    ...(spec.docsUrl ? { docsUrl: spec.docsUrl } : {}),
    licenseStatus: 'PENDING_REVIEW',
    implemented: false,
    notes: spec.notes,
    credentialFields: spec.fields,
    credentialSchema: z.object(shape) as unknown as MonitoringProvider['credentialSchema'],
    minIntervalMinutes: 60,
    test: () => Promise.resolve({ ok: false, message: PENDING_MESSAGE }),
    readDaily: () => Promise.reject(new Error(PENDING_MESSAGE)),
  };
}

const UNOFFICIAL_NOTE =
  'Endpoint usado pelo aplicativo/portal do fabricante, sem documentação pública nem contrato: pode violar os termos de uso e parar sem aviso. Não implementado.';

export const PENDING_PROVIDERS: MonitoringProvider[] = [
  pending({
    key: 'huawei-fusionsolar',
    label: 'Huawei FusionSolar (Northbound)',
    official: true,
    docsUrl: 'https://support.huawei.com/enterprise/en/doc/EDOC1100492747',
    notes:
      'Conta "openAPI" (usuário e código do sistema) pedida ao suporte da Huawei; a referência técnica completa exige login no portal da Huawei. Limite de frequência por minuto por interface.',
    fields: [
      field('host', 'Domínio do sistema', false, 'Ex.: o endereço do FusionSolar da sua região.'),
      field('userName', 'Usuário da API'),
      field('systemCode', 'Código do sistema', true),
    ],
  }),
  pending({
    key: 'growatt',
    label: 'Growatt OpenAPI v1',
    official: true,
    docsUrl: 'https://openapi.growatt.com/',
    notes:
      'Token gerado em server.growatt.com (Configurações → Gerenciar conta → API Key) ou no app ShinePhone; hosts por região (openapi, openapi-us, openapi-au, openapi-cn). A documentação oficial v1 não carregou para verificação.',
    fields: [
      field('token', 'Token da API', true),
      field('region', 'Região (openapi, openapi-us, openapi-au, openapi-cn)'),
    ],
  }),
  pending({
    key: 'sungrow',
    label: 'Sungrow iSolarCloud OpenAPI',
    official: true,
    docsUrl: 'https://developer-api.isolarcloud.com/',
    notes:
      'API Key, Access Key e chave RSA geradas em iSolarCloud → Configurações → Open API, mais usuário e senha. A documentação do portal de desenvolvedores é visível só após login.',
    fields: [
      field('appKey', 'API Key'),
      field('accessKey', 'Access Key', true),
      field('rsaPublicKey', 'Chave pública RSA', true),
      field('username', 'Usuário'),
      field('password', 'Senha', true),
    ],
  }),
  pending({
    key: 'deye',
    label: 'Deye Cloud OpenAPI',
    official: true,
    docsUrl: 'https://developer.deyecloud.com/',
    notes:
      'AppId e AppSecret obtidos ao registrar o aplicativo em developer.deyecloud.com; para o Brasil a base regional é a das Américas. A referência dos endpoints não pôde ser aberta para verificação.',
    fields: [
      field('appId', 'App Id'),
      field('appSecret', 'App Secret', true),
      field('email', 'E-mail da conta'),
      field('password', 'Senha', true),
    ],
  }),
  pending({
    key: 'solarman',
    label: 'Solarman OpenAPI',
    official: true,
    docsUrl: 'https://doc.solarmanpv.com/',
    notes:
      'A API precisa ser ativada pelo suporte da Solarman (appId e appSecret por pedido). A documentação é uma página dinâmica que não pôde ser verificada.',
    fields: [
      field('appId', 'App Id'),
      field('appSecret', 'App Secret', true),
      field('email', 'E-mail da conta'),
      field('password', 'Senha', true),
    ],
  }),
  pending({
    key: 'soliscloud',
    label: 'SolisCloud API',
    official: true,
    docsUrl:
      'https://usservice.solisinverters.com/support/solutions/articles/73000591225-soliscloud-api-guide',
    notes:
      'Habilitação da API pelo suporte da Solis; depois KeyID e KeySecret no portal (Serviço → Gerenciamento de API). Assinatura HMAC-SHA1 cujo exemplo do manual é reportado como inconsistente: não implementada sem conta de teste.',
    fields: [
      field('keyId', 'KeyID'),
      field('keySecret', 'KeySecret', true),
      field('apiUrl', 'URL da API'),
    ],
  }),
  pending({
    key: 'goodwe',
    label: 'GoodWe SEMS OpenAPI',
    official: true,
    notes:
      'Documentação não pública: a GoodWe exige NDA e habilita a permissão de API na conta SEMS. Sem a documentação pós-NDA, nada foi implementado.',
    fields: [field('account', 'E-mail da conta SEMS'), field('password', 'Senha', true)],
  }),
  pending({
    key: 'enphase',
    label: 'Enphase API v4',
    official: true,
    docsUrl: 'https://developer-v4.enphase.com/docs/quickstart.html',
    notes:
      'Exige OAuth2 com consentimento do dono do sistema (API Key, Client ID e Client Secret do portal de desenvolvedores; plano Watt gratuito). O fluxo de autorização e os parâmetros da energia diária no v4 não foram verificados.',
    fields: [
      field('apiKey', 'API Key'),
      field('clientId', 'Client ID'),
      field('clientSecret', 'Client Secret', true),
      field('refreshToken', 'Refresh token', true),
    ],
  }),
  pending({
    key: 'sma',
    label: 'SMA Monitoring API',
    official: true,
    docsUrl: 'https://developer.sma.de/api-access-control',
    notes:
      'OAuth2 com credenciais pedidas à SMA e consentimento do proprietário da usina; uso em produção exige contrato pago (por usina, ao ano). Só o ambiente de testes (sandbox) é aberto, e os campos das respostas não foram verificados.',
    fields: [field('clientId', 'Client ID'), field('clientSecret', 'Client Secret', true)],
  }),
  pending({
    key: 'growatt-portal',
    label: 'Growatt Portal (não oficial)',
    official: false,
    notes: UNOFFICIAL_NOTE,
    fields: [field('username', 'Usuário do portal'), field('password', 'Senha do portal', true)],
  }),
  pending({
    key: 'goodwe-sems',
    label: 'GoodWe SEMS (não oficial)',
    official: false,
    notes: UNOFFICIAL_NOTE,
    fields: [field('username', 'E-mail do SEMS'), field('password', 'Senha', true)],
  }),
  pending({
    key: 'hoymiles-smiles',
    label: 'Hoymiles S-Miles (não oficial)',
    official: false,
    notes: UNOFFICIAL_NOTE,
    fields: [field('username', 'Usuário do S-Miles'), field('password', 'Senha', true)],
  }),
  pending({
    key: 'solarman-portal',
    label: 'Solarman Portal (não oficial)',
    official: false,
    notes: UNOFFICIAL_NOTE,
    fields: [field('username', 'Usuário do portal'), field('password', 'Senha', true)],
  }),
  pending({
    key: 'huawei-kiosk',
    label: 'Huawei Kiosk (não oficial)',
    official: false,
    notes: UNOFFICIAL_NOTE,
    fields: [field('kioskUrl', 'Link público do quiosque')],
  }),
];
