/** Every /mandi page renders inside the Saffron Gold portal theme. */
import type { ReactNode } from 'react';

import { PortalShell } from '@/components/layout/PortalShell';

export default function MandiLayout({ children }: { children: ReactNode }) {
  return <PortalShell portal="mandi">{children}</PortalShell>;
}
