import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, LogOut, FileText, AlertTriangle, Shield, PieChart } from 'lucide-react';

export function PortalDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('projetos');

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await fetch('/api/v1/portal/dashboard', {
          credentials: 'include',
        });

        if (!res.ok) {
          setError('Falha ao carregar dados');
          setLoading(false);
          return;
        }
      } catch (err) {
        setError('Erro de conexão');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  const handleLogout = () => {
    document.cookie = 'portal_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
    navigate('/portal/entrar');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-gray-600">Carregando seu dashboard...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Seu Portal</h1>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {error && (
          <div className="flex gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-6">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Projetos ativos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">2</p>
              <p className="text-xs text-gray-500">Instalação em andamento</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Documentos pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">1</p>
              <p className="text-xs text-gray-500">Assinatura necessária</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Chamados abertos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">0</p>
              <p className="text-xs text-gray-500">Tudo operacional</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Informações da conta</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start border-b">
                <TabsTrigger value="projetos" className="flex gap-2">
                  <PieChart className="w-4 h-4" />
                  Projetos
                </TabsTrigger>
                <TabsTrigger value="documentos" className="flex gap-2">
                  <FileText className="w-4 h-4" />
                  Documentos
                </TabsTrigger>
                <TabsTrigger value="garantias" className="flex gap-2">
                  <Shield className="w-4 h-4" />
                  Garantias
                </TabsTrigger>
                <TabsTrigger value="chamados" className="flex gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Chamados
                </TabsTrigger>
              </TabsList>

              <TabsContent value="projetos" className="mt-6">
                <div className="space-y-4">
                  <p className="text-gray-600 text-sm">Seus projetos solar e seu status atual.</p>
                  <div className="text-center py-8 text-gray-500">
                    Nenhum projeto para exibir no momento.
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="documentos" className="mt-6">
                <div className="space-y-4">
                  <p className="text-gray-600 text-sm">
                    Documentos relacionados ao seu contrato e instalação.
                  </p>
                  <div className="text-center py-8 text-gray-500">Nenhum documento disponível.</div>
                </div>
              </TabsContent>

              <TabsContent value="garantias" className="mt-6">
                <div className="space-y-4">
                  <p className="text-gray-600 text-sm">Garantias dos equipamentos instalados.</p>
                  <div className="text-center py-8 text-gray-500">Nenhuma garantia registrada.</div>
                </div>
              </TabsContent>

              <TabsContent value="chamados" className="mt-6">
                <div className="space-y-4">
                  <p className="text-gray-600 text-sm">Chamados de suporte e manutenção.</p>
                  <div className="text-center py-8 text-gray-500">Nenhum chamado aberto.</div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
