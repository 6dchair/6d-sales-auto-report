// A small set of plain, square-cornered line icons used only where an icon
// helps (menu, close, search, dropdown arrow). Everything else is text.

type IconName = "menu" | "close" | "search" | "chevron";

const PATHS: Record<IconName, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20",
  chevron: "M6 9l6 6 6-6",
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Brand mark: rising bars with an upward trend line.
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="16" width="4" height="5" fill="currentColor" opacity="0.5" />
      <rect x="10" y="13" width="4" height="8" fill="currentColor" opacity="0.5" />
      <rect x="17" y="9" width="4" height="12" fill="currentColor" opacity="0.5" />
      <path
        d="M3 12L9 8.5L13 10.5L20 4M16 4h4v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
