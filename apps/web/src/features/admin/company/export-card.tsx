import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  toast,
} from '@voltex/ui';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** Portabilidade (LGPD): baixa todos os dados da empresa em um arquivo JSON. */
export function ExportCard() {
  const exportData = useMutation({
    mutationFn: async () => {
      const data = await endpoints.tenant.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `voltex-dados-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('Exportação gerada'),
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível exportar os dados.')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exportar os dados da empresa</CardTitle>
        <CardDescription>
          Baixa tudo o que é da sua empresa (leads, contas, oportunidades, propostas, contratos,
          projetos…) em JSON, com CPF/CNPJ em claro. Não inclui senhas nem os arquivos enviados (só
          a lista deles). O arquivo contém dados pessoais: guarde com cuidado. A exportação fica
          registrada na auditoria.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          disabled={exportData.isPending}
          onClick={() => exportData.mutate()}
        >
          {exportData.isPending ? <Spinner /> : <Download />}
          Exportar dados
        </Button>
      </CardContent>
    </Card>
  );
}
