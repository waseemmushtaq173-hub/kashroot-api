/**
 * PriceComparisonHeader — the fix for the invisible "List your products" text.
 *
 * The old header was dark blue, so its "List your products" call to action
 * vanished into it. It is now a soft, light premium gradient with high-contrast
 * text, and the CTA is a solid button that stands on its own:
 *
 *   header  bg-gradient-to-r from-sky-50/90 via-white/80 to-amber-50/90
 *           border-b border-sky-100 backdrop-blur-xl
 *   title   text-slate-900                       ≈17:1 on sky-50
 *   body    text-slate-600                       ≈7:1
 *   CTA     bg-sky-700 text-white hover:bg-sky-800   ≈5.9:1 (AA)
 *
 * Drop it in where the dark header was, or let app/price-comparison/layout.tsx
 * render it above every Price Comparison page.
 */
import Link from 'next/link';

import { PortalHeader } from '@/components/layout/PortalShell';
import { ArrowRightIcon } from '@/components/ui/icons';
import { PORTALS } from '@/lib/portals';

const { theme } = PORTALS.priceComparison;

interface PriceComparisonHeaderProps {
  /** Point at your existing product-listing route. */
  listProductsHref?: string;
}

export function PriceComparisonHeader({
  listProductsHref = `${PORTALS.priceComparison.href}/list`,
}: PriceComparisonHeaderProps) {
  return (
    <PortalHeader
      portal="priceComparison"
      description="Compare verified offers side by side — or list your own produce for buyers across India."
      actions={
        <Link
          href={listProductsHref}
          className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-md shadow-sky-700/20 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.primaryButton}`}
        >
          List your products
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      }
    />
  );
}
