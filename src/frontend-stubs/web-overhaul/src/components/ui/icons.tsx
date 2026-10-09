/**
 * Inline stroke icons for the overhaul components. Dependency-free on purpose so
 * the files drop into the web app without adding a package; they are drawn on a
 * 24px grid and inherit `currentColor`, so swapping in lucide-react later is a
 * rename. Size them with classes (`h-5 w-5`) — CSS wins over the width/height
 * attributes.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function svgProps(props: IconProps): IconProps {
  return {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...props,
  };
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function TrendingUpIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3v18M7 21h10M5 7h14" />
      <path d="M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8 5l11 7-11 7V5z" />
    </svg>
  );
}

/** Pair with `animate-spin`. */
export function SpinnerIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" />
    </svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20 4C11 4 5 9 5 17c0 1 .1 2 .3 3C13.9 20 20 14 20 4z" />
      <path d="M4 20c4-5 8-8 12-10" />
    </svg>
  );
}

export function ShoppingBagIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 7h12l1 13H5L6 7z" />
      <path d="M9 7a3 3 0 016 0" />
    </svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 8l2-5h14l2 5" />
      <path d="M3 8a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" />
      <path d="M5 11v9h14v-9M10 20v-5h4v5" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

export function BankIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
    </svg>
  );
}

export function IdCardIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16c.6-1.5 1.8-2 3-2s2.4.5 3 2M15 10h3M15 13h3" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3 3 0 010 7M18 14c2 .7 3 2.6 3 6" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1" />
      <path d="M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.9 9.9 0 005.4-1.6" />
      <path d="M9.9 9.9a3 3 0 004.2 4.2" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

export function FileCheckIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5M9 14l2 2 4-4" />
    </svg>
  );
}

export function SmartphoneIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}
