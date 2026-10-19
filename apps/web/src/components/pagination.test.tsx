import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('mostra o intervalo e navega entre páginas', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} pageSize={10} total={25} onPageChange={onPageChange} />);
    expect(screen.getByText('11–20 de 25')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Próxima/ }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: /Anterior/ }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('desabilita os limites e trata lista vazia', () => {
    const { rerender } = render(
      <Pagination page={1} pageSize={10} total={5} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Próxima/ })).toBeDisabled();
    expect(screen.getByText('1–5 de 5')).toBeInTheDocument();
    rerender(<Pagination page={1} pageSize={10} total={0} onPageChange={() => undefined} />);
    expect(screen.getByText('Nenhum resultado')).toBeInTheDocument();
  });
});
