/** Sprint 11 (design 31.4): the save icon, outlined or filled when saved. */
import Svg, { Path } from 'react-native-svg';

export function BookmarkIcon({
  color,
  size = 24,
  filled = false,
}: {
  color: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3h12v18l-6-4-6 4z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}
