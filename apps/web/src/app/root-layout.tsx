import { Outlet } from 'react-router';
import { DocumentTitle } from './document-title';

export function RootLayout() {
  return (
    <>
      <DocumentTitle />
      <Outlet />
    </>
  );
}
