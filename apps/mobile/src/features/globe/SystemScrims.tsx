/**
 * Dark gradients behind the status bar and the navigation bar (sprint 1 AC-9,
 * design 6.4). Under edge-to-edge the imagery reaches the screen edges, and
 * light system icons over the Sahara or ice would fall well below 3:1.
 * Drawn with react-native-svg; they take no touches and cost Mapbox nothing.
 */
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { globe } from '@/theme/tokens';

const { color, opacityEdge, opacityInset, fadeLength, bottomFadeLength } = globe.systemScrim;

interface Props {
  insetsTop: number;
  insetsBottom: number;
}

export function SystemScrims({ insetsTop, insetsBottom }: Props) {
  const topHeight = insetsTop + fadeLength;
  const bottomHeight = insetsBottom + bottomFadeLength;
  return (
    <>
      <View pointerEvents="none" style={[styles.top, { height: topHeight }]} testID="scrim-top">
        <Gradient
          id="scrim-top"
          height={topHeight}
          // Edge, then the status bar's lower edge, then clear.
          stops={[
            [0, opacityEdge],
            [insetsTop / topHeight, opacityInset],
            [1, 0],
          ]}
        />
      </View>
      <View
        pointerEvents="none"
        style={[styles.bottom, { height: bottomHeight }]}
        testID="scrim-bottom"
      >
        <Gradient
          id="scrim-bottom"
          height={bottomHeight}
          stops={[
            [0, 0],
            [bottomFadeLength / bottomHeight, opacityInset],
            [1, opacityEdge],
          ]}
        />
      </View>
    </>
  );
}

function Gradient({
  id,
  height,
  stops,
}: {
  id: string;
  height: number;
  stops: [offset: number, opacity: number][];
}) {
  return (
    <Svg width="100%" height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {stops.map(([offset, opacity], index) => (
            <Stop key={index} offset={offset} stopColor={color} stopOpacity={opacity} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, start: 0, end: 0 },
  bottom: { position: 'absolute', bottom: 0, start: 0, end: 0 },
});
