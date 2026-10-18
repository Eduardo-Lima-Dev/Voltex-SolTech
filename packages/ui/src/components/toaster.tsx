import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';

/** Notificações (toast). Monte `<Toaster />` uma vez na raiz do app e use `toast.success(...)`. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, toast };
