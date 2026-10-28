import { Sparkles } from 'lucide-react';
import { Button } from '@voltex/ui';
import { Can } from '@/app/guards';
import { useAssistant } from './assistant-context';

interface Props {
  /** Texto do botão (ex.: "Resumir com IA"). */
  label: string;
  question: string;
  projectCode?: string;
  screen?: string;
}

/** Copiloto das fichas: abre o painel do assistente já com a pergunta pronta. Some sem a permissão. */
export function AskAssistantButton({ label, question, projectCode, screen }: Props) {
  const assistant = useAssistant();
  if (!assistant) return null;
  return (
    <Can permission="ai.assistant.use">
      <Button
        variant="outline"
        size="sm"
        onClick={() => assistant.ask({ question, projectCode, screen })}
      >
        <Sparkles /> {label}
      </Button>
    </Can>
  );
}
