/**
 * Sprint 11 AC-5 (design 8.2, D9; Raz design approval 6): the hotel's point,
 * picked on a street map. The pin stays in the middle and the map moves under
 * it. No geocoding and no search: nothing about the hotel leaves the device
 * but Mapbox's tiles. TalkBack moves the map with actions, and the
 * coordinates can be typed (required: the way without dragging).
 */
import { Camera, MapView } from '@rnmapbox/maps';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/fields';
import { ClearIcon, MapPinIcon, MinusCircleIcon, PlusIcon } from '@/components/icons';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

const STREETS = 'mapbox://styles/mapbox/streets-v12';

/** "13.7563, 100.5018" (as copied from a maps app) → [lng, lat], or null. */
export function parseCoordinates(text: string): [number, number] | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
}

/** Design 8.2: kept to 6 decimals (about 10 cm). */
export const roundPoint = ([lng, lat]: [number, number]): [number, number] => [
  Math.round(lng * 1e6) / 1e6,
  Math.round(lat * 1e6) / 1e6,
];

/** "13.756300, 100.501800", latitude first, as people read it. */
export const pointText = ([lng, lat]: [number, number]) => `⁦${lat.toFixed(6)}, ${lng.toFixed(6)}⁩`;

export function MapPointPicker({
  start,
  colorScheme,
  insetsTop,
  insetsBottom,
  onClose,
  onPick,
}: {
  /** Design 8.2: the saved point (zoom 16), the trip's first city (13), or the country (6). */
  start: { point: [number, number]; zoom: number };
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onPick: (point: [number, number]) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const camera = useRef<ComponentRef<typeof Camera>>(null);
  const [center, setCenter] = useState(start.point);
  const [zoom, setZoom] = useState(start.zoom);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState(false);

  const moveTo = (point: [number, number], level = zoom) => {
    setCenter(point);
    setZoom(level);
    camera.current?.setCamera({ centerCoordinate: point, zoomLevel: level, animationDuration: 0 });
  };
  /** Half the screen's width at this zoom, roughly, for the TalkBack moves. */
  const step = 90 / 2 ** zoom;
  const actions = [
    { name: 'north', label: t('mapPoint.north') },
    { name: 'south', label: t('mapPoint.south') },
    { name: 'east', label: t('mapPoint.east') },
    { name: 'west', label: t('mapPoint.west') },
    { name: 'zoomIn', label: t('mapPoint.zoomIn') },
    { name: 'zoomOut', label: t('mapPoint.zoomOut') },
  ];
  const act = (name: string) => {
    const [lng, lat] = center;
    if (name === 'north') moveTo([lng, Math.min(85, lat + step)]);
    else if (name === 'south') moveTo([lng, Math.max(-85, lat - step)]);
    else if (name === 'east') moveTo([lng + step, lat]);
    else if (name === 'west') moveTo([lng - step, lat]);
    else if (name === 'zoomIn') moveTo(center, Math.min(19, zoom + 1));
    else if (name === 'zoomOut') moveTo(center, Math.max(2, zoom - 1));
  };

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.screen, { backgroundColor: p.canvas, paddingTop: insetsTop }]}
        testID="map-point"
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('activity.close')}
            onPress={onClose}
            style={styles.icon}
            testID="map-point-close"
          >
            <ClearIcon color={p.textPrimary} />
          </Pressable>
          <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
            {t('mapPoint.title')}
          </Text>
        </View>
        <View
          style={styles.map}
          accessible
          accessibilityLabel={t('mapPoint.mapA11y', { point: pointText(center) })}
          accessibilityActions={actions}
          onAccessibilityAction={(e) => act(e.nativeEvent.actionName)}
          testID="map-point-map"
        >
          <MapView
            style={StyleSheet.absoluteFill}
            styleURL={STREETS}
            scaleBarEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
            onCameraChanged={(state) => {
              const c = state.properties.center as [number, number];
              setCenter(c);
              setZoom(state.properties.zoom);
            }}
          >
            <Camera
              ref={camera}
              defaultSettings={{ centerCoordinate: start.point, zoomLevel: start.zoom }}
            />
          </MapView>
          <View pointerEvents="none" style={styles.pin}>
            <MapPinIcon color={p.ctaBg} size={40} />
          </View>
          <View style={styles.zoom}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mapPoint.zoomIn')}
              onPress={() => act('zoomIn')}
              style={[styles.zoomButton, { backgroundColor: p.chromeBg }]}
              testID="map-point-zoom-in"
            >
              <PlusIcon color={p.chromeFg} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mapPoint.zoomOut')}
              onPress={() => act('zoomOut')}
              style={[styles.zoomButton, { backgroundColor: p.chromeBg }]}
              testID="map-point-zoom-out"
            >
              <MinusCircleIcon color={p.chromeFg} />
            </Pressable>
          </View>
        </View>
        <View
          style={[
            styles.panel,
            { paddingBottom: insetsBottom + 12, backgroundColor: p.surfaceRaised },
          ]}
        >
          <Text style={[styles.callout, { color: p.textPrimary }]}>{t('mapPoint.help')}</Text>
          <Text style={[styles.footnote, { color: p.textSecondary }]} testID="map-point-coords">
            {pointText(roundPoint(center))}
          </Text>
          <View style={styles.typedRow}>
            <TextInput
              value={typed}
              onChangeText={(text) => {
                setTyped(text);
                setTypedError(false);
              }}
              onSubmitEditing={() => {
                const point = parseCoordinates(typed);
                if (point) moveTo(point, Math.max(zoom, 15));
                else setTypedError(true);
              }}
              placeholder={t('mapPoint.typePlaceholder')}
              placeholderTextColor={p.textTertiary}
              accessibilityLabel={t('mapPoint.typeA11y')}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              style={[
                styles.input,
                { borderColor: typedError ? p.textAlert : p.borderControl, color: p.textPrimary },
              ]}
              testID="map-point-type"
            />
          </View>
          {typedError ? (
            <Text
              style={[styles.footnote, { color: p.textAlert }]}
              accessibilityLiveRegion="polite"
            >
              {t('mapPoint.typeError')}
            </Text>
          ) : null}
          <Button
            kind="primary"
            label={t('mapPoint.choose')}
            onPress={() => onPick(roundPoint(center))}
            colorScheme={colorScheme}
            testID="map-point-choose"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { minHeight: layout.formBarHeight, flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  map: { flex: 1 },
  pin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -40 },
  zoom: { position: 'absolute', start: 12, top: 12, gap: 8 },
  zoomButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: { padding: 16, gap: 8 },
  typedRow: { flexDirection: 'row' },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'left',
    fontVariant: ['tabular-nums'],
  },
});
