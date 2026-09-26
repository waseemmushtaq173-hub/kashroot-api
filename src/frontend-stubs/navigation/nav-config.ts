/**
 * Per-persona navigation manifests. Each layout renders its own chrome (bottom
 * bar / sidebar / topbar) but reads its links from here so routes stay in one
 * place. `icon` is an emoji placeholder — swap for lucide-react (web) or
 * @expo/vector-icons (native) in the real build.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

export const farmerNav: NavItem[] = [
  { label: 'Home', href: '/farmer', icon: '🏠' },
  { label: 'Mandi', href: '/farmer/mandi', icon: '📈' },
  { label: 'Orders', href: '/farmer/orders', icon: '📦' },
  { label: 'Profile', href: '/farmer/profile', icon: '👤' },
];

export const buyerNav: NavItem[] = [
  { label: 'Dashboard', href: '/buyer', icon: '📊' },
  { label: 'Marketplace', href: '/buyer/market', icon: '🛒' },
  { label: 'Orders & Escrow', href: '/buyer/orders', icon: '🔒' },
  { label: 'Farmers', href: '/buyer/farmers', icon: '🌾' },
  { label: 'Analytics', href: '/buyer/analytics', icon: '📉' },
];

export const expertNav: NavItem[] = [
  { label: 'Overview', href: '/expert', icon: '🩺' },
  { label: 'Appointments', href: '/expert/appointments', icon: '📅' },
  { label: 'My KYC', href: '/expert/kyc', icon: '✅' },
];

export const adminNav: NavItem[] = [
  { label: 'Overview', href: '/admin', icon: '🏛️' },
  { label: 'KYC Queue', href: '/admin/kyc', icon: '🗂️' },
  { label: 'Ledger', href: '/admin/ledger', icon: '📒' },
  { label: 'Mandi Boards', href: '/admin/mandi', icon: '📈' },
  { label: 'Disputes', href: '/admin/disputes', icon: '⚖️' },
];
