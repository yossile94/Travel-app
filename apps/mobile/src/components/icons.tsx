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
