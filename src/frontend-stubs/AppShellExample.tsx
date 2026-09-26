/**
 * AppShellExample — how the pieces compose in a Next.js App Router root layout.
 * This is a REFERENCE wiring, not a live route. Copy the composition into
 * app/(protected)/layout.tsx once the real auth session hook is in place.
 *
 *   <AuthProvider>              // holds identity + UserRole
 *     <RoleLayoutRouter>        // picks Farmer/Buyer/Expert/Admin shell
 *       {children}              // the active route segment renders here
 *     </RoleLayoutRouter>
 *   </AuthProvider>
 *
 * The demo swaps `demoUser` to preview each persona shell.
 */
import { AuthProvider, type AuthUser } from './auth/AuthContext';
import { RoleLayoutRouter } from './navigation/RoleLayoutRouter';
import { FarmerHome } from './features/farmer/FarmerHome';

const demoUser: AuthUser = {
  id: 'demo-1',
  displayName: 'Bashir Ahmad',
  role: 'FARMER',
  preferredLanguage: 'KASHMIRI',
  accessToken: 'demo-token',
};

export function AppShellExample() {
  return (
    <AuthProvider initialUser={demoUser}>
      <RoleLayoutRouter>
        {/* In the real app this is the routed page; here we preview FarmerHome. */}
        <FarmerHome />
      </RoleLayoutRouter>
    </AuthProvider>
  );
}
