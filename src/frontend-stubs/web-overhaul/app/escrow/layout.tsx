/** Every /escrow page renders inside the Emerald Trust portal theme. */
import type { ReactNode } from 'react';

import { PortalShell } from '@/components/layout/PortalShell';

export default function EscrowLayout({ children }: { children: ReactNode }) {
  return <PortalShell portal="escrow">{children}</PortalShell>;
}
