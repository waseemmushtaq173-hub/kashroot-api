/**
 * Every /price-comparison page renders inside the Dal Lake Azure portal theme,
 * under the light PriceComparisonHeader. Remove the old dark header from the
 * pages themselves, or it will render twice.
 */
import type { ReactNode } from 'react';

import { PortalShell } from '@/components/layout/PortalShell';
import { PriceComparisonHeader } from '@/components/price-comparison/PriceComparisonHeader';

export default function PriceComparisonLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell portal="priceComparison" header={<PriceComparisonHeader />}>
      {children}
    </PortalShell>
  );
}
