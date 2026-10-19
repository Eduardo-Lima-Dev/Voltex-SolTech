import { Outlet } from 'react-router';
import { RequirePermission } from '@/app/guards';

/** Todo o Solar Calculator exige poder ver cálculos; criar e salvar snapshot têm checagens próprias. */
export function CalculatorLayout() {
  return (
    <RequirePermission permission="calculator.session.read">
      <Outlet />
    </RequirePermission>
  );
}
