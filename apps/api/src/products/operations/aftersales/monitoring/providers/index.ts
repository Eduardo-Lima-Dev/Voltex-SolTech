import { apsystems } from './apsystems';
import { fronius } from './fronius';
import { PENDING_PROVIDERS } from './pending';
import { solaredge } from './solaredge';
import type { MonitoringProvider } from './types';

export const MONITORING_PROVIDERS: MonitoringProvider[] = [
  solaredge,
  apsystems,
  fronius,
  ...PENDING_PROVIDERS,
];
export type { MonitoringProvider } from './types';
