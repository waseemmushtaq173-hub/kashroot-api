/** Farmer sign-in — orchard green, phone-first: "Manage your orchards". */
import { LeafIcon } from '@/components/ui/icons';

import { RoleLoginForm, type RoleLoginTheme } from './RoleLoginForm';

const FARMER_THEME: RoleLoginTheme = {
  canvas: 'bg-gradient-to-br from-lime-50 via-emerald-50 to-teal-50',
  glowA: 'bg-emerald-300/40',
  glowB: 'bg-lime-200/50',
  story: 'bg-gradient-to-br from-emerald-100/80 via-lime-50/70 to-white/30',
  iconTile: 'bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-lg shadow-emerald-600/30',
  eyebrow: 'text-emerald-800',
  bullet: 'text-emerald-600',
  button: 'bg-emerald-700 text-white shadow-emerald-700/25 hover:bg-emerald-800',
  link: 'text-emerald-800 hover:text-emerald-900 hover:underline underline-offset-4',
  outline: 'focus-visible:outline-emerald-700',
  inputFocus: 'focus:ring-emerald-500',
};

export function FarmerLogin({ next }: { next?: string }) {
  return (
    <RoleLoginForm
      role="farmer"
      next={next}
      icon={<LeafIcon className="h-6 w-6" />}
      eyebrow="Farmer portal"
      headline="Manage your orchards"
      description="Track today’s mandi rates, list your harvest and get paid safely through escrow."
      highlights={[
        'Live rates from your nearest mandi',
        'List apples, saffron, walnuts and more',
        'Payment released only on delivery',
      ]}
      identifierLabel="Mobile number or email"
      identifierPlaceholder="98765 43210"
      theme={FARMER_THEME}
    />
  );
}
