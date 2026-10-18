import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@voltex/ui';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Paginação simples: "11–20 de 53" com anterior/próxima. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground"
    >
      <p aria-live="polite">{total === 0 ? 'Nenhum resultado' : `${from}–${to} de ${total}`}</p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft /> Anterior
        </Button>
        <span className="px-2">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          Próxima <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
