import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './theme';

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <p data-testid="theme">{theme}</p>
      <p data-testid="resolved">{resolvedTheme}</p>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

function mockSystemDark(initial: boolean) {
  let listener: ((e: MediaQueryListEvent) => void) | undefined;
  window.matchMedia = vi.fn((query: string) => ({
    matches: initial,
    media: query,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => (listener = cb),
    removeEventListener: () => (listener = undefined),
  })) as unknown as typeof window.matchMedia;
  return (matches: boolean) => listener?.({ matches } as MediaQueryListEvent);
}

describe('ThemeProvider', () => {
  it('começa em "sistema" e segue a preferência do sistema operacional, inclusive quando ela muda', () => {
    const changeSystem = mockSystemDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');

    act(() => changeSystem(true));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('escolha explícita vale mais que o sistema e é lembrada', async () => {
    mockSystemDark(true);
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByText('light'));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('voltex:theme')).toBe('light');
    unmount();

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('ignora valor inválido guardado e funciona sem armazenamento (modo privado)', async () => {
    mockSystemDark(false);
    localStorage.setItem('voltex:theme', 'roxo');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    await userEvent.click(screen.getByText('dark'));
    expect(document.documentElement).toHaveClass('dark');
    setItem.mockRestore();
  });

  it('useTheme fora do provider lança erro claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});
