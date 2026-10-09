/** Seller sign-in — saffron gold, business-first: "Grow your agri-business". */
import { StoreIcon } from '@/components/ui/icons';

import { RoleLoginForm, type RoleLoginTheme } from './RoleLoginForm';

const SELLER_THEME: RoleLoginTheme = {
  canvas: 'bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50',
  glowA: 'bg-amber-300/40',
  glowB: 'bg-rose-200/40',
  story: 'bg-gradient-to-br from-amber-100/80 via-orange-50/60 to-white/30',
  iconTile: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-500/30',
  eyebrow: 'text-amber-800',
  bullet: 'text-amber-600',
  // Dark text on saffron reads better than white (≈9:1 vs ≈2:1).
  button: 'bg-amber-400 text-amber-950 shadow-amber-500/25 hover:bg-amber-300',
  link: 'text-amber-800 hover:text-amber-900 hover:underline underline-offset-4',
  outline: 'focus-visible:outline-amber-600',
  inputFocus: 'focus:ring-amber-500',
};

export function SellerLogin({ next }: { next?: string }) {
  return (
    <RoleLoginForm
      role="seller"
      next={next}
      icon={<StoreIcon className="h-6 w-6" />}
      eyebrow="Seller portal"
      headline="Grow your agri-business"
      description="List your products, reach buyers across India and follow every order from dispatch to payout."
      highlights={['List products in minutes', 'Reach verified buyers nationwide', 'Escrow-backed payouts']}
      identifierLabel="Business email or mobile number"
      identifierPlaceholder="you@business.com"
      theme={SELLER_THEME}
    />
  );
}
