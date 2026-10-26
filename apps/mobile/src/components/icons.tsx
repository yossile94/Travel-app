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
