import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Logo,
  SidebarMenuButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from './index';

describe('cn', () => {
  it('resolve conflitos do Tailwind', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('a', { b: false }, undefined, 'c')).toBe('a c');
  });
});

describe('Button', () => {
  it('dispara onClick e usa type="button" por padrão', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('aplica variantes e respeita disabled', () => {
    render(
      <Button variant="destructive" size="lg" disabled>
        Excluir
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Excluir' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('bg-destructive');
  });

  it('asChild renderiza o filho com os estilos do botão', () => {
    render(
      <Button asChild>
        <a href="/crm">CRM</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'CRM' });
    expect(link).toHaveAttribute('href', '/crm');
    expect(link.className).toContain('bg-primary');
  });
});

describe('Badge, Card, Table, Logo, Sidebar', () => {
  it('Badge expõe as variantes do semáforo', () => {
    render(
      <>
        <Badge variant="green">Verde</Badge>
        <Badge variant="yellow">Amarelo</Badge>
        <Badge variant="red">Vermelho</Badge>
      </>,
    );
    expect(screen.getByText('Verde').className).toContain('bg-success');
    expect(screen.getByText('Amarelo').className).toContain('bg-warning');
    expect(screen.getByText('Vermelho').className).toContain('bg-destructive');
  });

  it('renderiza Card, Table, Logo e item de menu ativo', () => {
    render(
      <>
        <Card>
          <CardTitle>Resumo</CardTitle>
          <CardContent>4,40 kWp</CardContent>
        </Card>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Lead</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Logo />
        <SidebarMenuButton isActive>Leads</SidebarMenuButton>
      </>,
    );
    expect(screen.getByText('Resumo')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Voltex SolTech').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Leads' })).toHaveAttribute('data-active', 'true');
  });
});

describe('Tabs e Dialog', () => {
  it('troca de aba', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Conteúdo A</TabsContent>
        <TabsContent value="b">Conteúdo B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Conteúdo A')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('Conteúdo B')).toBeVisible();
  });

  it('abre o diálogo', async () => {
    render(
      <Dialog>
        <DialogTrigger>Abrir</DialogTrigger>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>Descrição</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText('Título')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Abrir'));
    expect(await screen.findByText('Título')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });
});

describe('Form (react-hook-form)', () => {
  function Example({ onSubmit }: { onSubmit: (v: { email: string }) => void }) {
    const form = useForm<{ email: string }>({ defaultValues: { email: '' } });
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="email"
            rules={{ required: 'Informe o e-mail' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Enviar</Button>
        </form>
      </Form>
    );
  }

  it('mostra a mensagem de erro e marca o campo como inválido', async () => {
    const onSubmit = vi.fn();
    render(<Example onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o e-mail');
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('envia quando válido', async () => {
    const onSubmit = vi.fn();
    render(<Example onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b.com' }, expect.anything());
  });
});
