/**
 * Line icons for the controls over the globe (24×24 grid, 2pt stroke).
 * Drawn with react-native-svg so no icon font or extra dependency is needed.
 */
import { I18nManager } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

interface IconProps {
  color: string;
  size?: number;
}

const stroke = { strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Magnifier. Not mirrored in RTL: it depicts an object. */
export function SearchIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} {...stroke} />
      <Line x1={15.5} y1={15.5} x2={20} y2={20} stroke={color} {...stroke} />
    </Svg>
  );
}

/** "Back": points to the start edge, so it is mirrored in RTL (points right in Hebrew). */
export function BackIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <Path d="M19 12H5M11 6l-6 6 6 6" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ClearIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} {...stroke} />
    </Svg>
  );
}

/** Suitcase for "My trips". Not mirrored: an object. */
export function SuitcaseIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8h16v11H4zM9 8V5h6v3M9 8v11M15 8v11" stroke={color} {...stroke} />
    </Svg>
  );
}

export function PlusIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v14M5 12h14" stroke={color} {...stroke} />
    </Svg>
  );
}

/** "Expand": vertical, so never mirrored. */
export function ChevronDownIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9l6 6 6-6" stroke={color} {...stroke} />
    </Svg>
  );
}

/** "Next": points to the end edge, so it is mirrored in RTL (points left in Hebrew). */
export function NextIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <Path d="M9 6l6 6-6 6" stroke={color} {...stroke} />
    </Svg>
  );
}

export function PencilIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" stroke={color} {...stroke} />
    </Svg>
  );
}

export function TrashIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A clock, for time fields (sprint 5 design 4.1). */
export function ClockIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3 2" stroke={color} {...stroke} />
    </Svg>
  );
}

export function CalendarIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A cloud with a line through it: no connection. */
export function CloudOffIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 18h10a4 4 0 00.8-7.9A6 6 0 006.3 9 4.5 4.5 0 007 18zM3 3l18 18"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}

export function AlertIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} {...stroke} />
      <Path d="M12 7v6M12 16.5v.5" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ShieldIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" stroke={color} {...stroke} />
    </Svg>
  );
}

export function DownloadIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" stroke={color} {...stroke} />
    </Svg>
  );
}

/** Globe with a plus, for the empty trips list. */
export function GlobePlusIcon({ color, size = 48 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={12} r={8} stroke={color} strokeWidth={1.5} />
      <Path
        d="M3 12h16M11 4c2.5 2.5 2.5 13.5 0 16M11 4c-2.5 2.5-2.5 13.5 0 16"
        stroke={color}
        strokeWidth={1.5}
      />
      <Path d="M19 2v5M16.5 4.5h5" stroke={color} {...stroke} />
    </Svg>
  );
}

/** Two people: the traveler count. Not mirrored: an object. */
export function PeopleIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3.5} stroke={color} {...stroke} />
      <Path
        d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15.5 4.8a3.5 3.5 0 010 6.4M18 14.4c1.8.9 3 2.9 3 5.6"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}

/** Two pages: "Duplicate". Not mirrored: an object. */
export function CopyIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 8h11v12H8zM5 16V4h11" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A circle with a minus: remove an item from a list (not ×, which closes screens). */
export function MinusCircleIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} {...stroke} />
      <Path d="M8 12h8" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A person: "me" in the travelers list. */
export function PersonIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} {...stroke} />
      <Path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} {...stroke} />
    </Svg>
  );
}

/** No entry: a circle with a bar (sprint 4 design 5.1). Not mirrored. */
export function NoEntryIcon({ color, size = 12 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} {...stroke} />
      <Line x1={5.6} y1={5.6} x2={18.4} y2={18.4} stroke={color} {...stroke} />
    </Svg>
  );
}

/** A warning triangle (sprint 4 design 5.1). Not mirrored. */
export function WarningIcon({ color, size = 12 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3L2 20h20L12 3z" stroke={color} {...stroke} />
      <Path d="M12 10v4M12 17v.5" stroke={color} {...stroke} />
    </Svg>
  );
}

/** A calculator (sprint 4 design 2.1). Not mirrored: it depicts an object. */
export function CalculatorIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"
        stroke={color}
        {...stroke}
      />
      <Path
        d="M8 7h8M8 12h.5M12 12h.5M16 12h.5M8 16h.5M12 16h.5M16 16h.5"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}

/** A chevron toward the end of the line: points left in Hebrew (sprint 4 design 6.2). */
export function ChevronEndIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <Path d="M9 6l6 6-6 6" stroke={color} {...stroke} />
    </Svg>
  );
}

/** An external link (sprint 4 design 7.1). Not mirrored. */
export function ExternalLinkIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}

/** Sprint 6 design 3.5: the alert's plane, nose up (not mirrored: it points up in both languages). */
export function PlaneUpIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M12 2c.9 0 1.5.9 1.5 2v5.2l7.5 4.4V16l-7.5-2.3v4.9l2.5 1.8V22L12 21l-4 1v-1.6l2.5-1.8v-4.9L3 16v-2.4l7.5-4.4V4c0-1.1.6-2 1.5-2z"
      />
    </Svg>
  );
}

/** Sprint 6 design 6.1: the "flight alerts" row. */
export function BellIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" stroke={color} {...stroke} />
      <Path d="M10 21h4" stroke={color} {...stroke} />
    </Svg>
  );
}

/** Sprint 7 design 3.1: the layover between two legs. Not mirrored: an object. */
export function HourglassIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}

// Sprint 8 design 23.4: objects, not directions, so none is mirrored in RTL.
function pathIcon(d: string) {
  return function Icon({ color, size = 24 }: IconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d={d} stroke={color} {...stroke} />
      </Svg>
    );
  };
}

/** Handset: dial a number. */
export const PhoneIcon = pathIcon(
  'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2',
);
/** A banknote: the currency tile (country card fix 12.2). */
export const BanknoteIcon = pathIcon(
  'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6.5 12h.01M17.5 12h.01',
);
/** A thermometer: the temperature tile, an average, not the weather now (12.2). */
export const ThermometerIcon = pathIcon('M10 13.8V5a2 2 0 114 0v8.8a4 4 0 11-4 0zM12 9v6.5');
/** A map pin: "What to see" on the country card (sprint 11, design 31.4). */
export const MapPinIcon = pathIcon(
  'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
);
/** Check: inside the switch's thumb when on (sprint 12 P-3). Not mirrored in RTL. */
export const CheckIcon = pathIcon('M5 12.5l4.5 4.5L19 7.5');
/** Bed: a hotel. */
export const BedIcon = pathIcon(
  'M3 7v12M3 13h18v6M21 13v-2a3 3 0 00-3-3h-7v5M7 11.5a1.5 1.5 0 100-.01',
);
/** Car: "show to driver". */
export const CarIcon = pathIcon(
  'M5 17h14v-5l-2-5H7l-2 5zM5 12h14M7.5 14.5h.01M16.5 14.5h.01M6 17v2M18 17v2',
);
/**
 * Navigation arrow, tilted 45°: directions in a maps app (sprint 12 P-5; the upright
 * one read as the letter A). Not mirrored in RTL. Used by What to see, the daily
 * board, the driver card and the hotels.
 */
export const NavigateIcon = pathIcon('M3 11l19-9-9 19-2-8z');
/** Share. */
export const ShareIcon = pathIcon(
  'M18 5.5a2.5 2.5 0 100 .01M6 12a2.5 2.5 0 100 .01M18 18.5a2.5 2.5 0 100 .01M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1',
);
/** Document: the policy file. */
export const FileIcon = pathIcon('M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5');

/** Sun: the weather chip (sprint 9 design 18.4). Not mirrored in RTL. */
export const SunIcon = pathIcon(
  'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
);

// Sprint 10 design 33.4: objects, not mirrored in RTL.
/** Passport: "My passports". */
export const PassportIcon = pathIcon(
  'M6 3h11a1 1 0 011 1v16a1 1 0 01-1 1H6zM12 8.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM9.5 17h5',
);
/** Camera: take the photo. */
export const CameraIcon = pathIcon('M4 8h3l1.5-2h7L17 8h3v11H4zM12 10.5a3 3 0 100 6 3 3 0 000-6z');
/** Picture: from the gallery. */
export const ImageIcon = pathIcon('M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 8.5h.01');
/** Lock: kept encrypted, opens with authentication. */
export const LockIcon = pathIcon('M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3');
