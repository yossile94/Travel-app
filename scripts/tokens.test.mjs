/**
 * Keeps the app's design tokens (apps/mobile/src/theme/tokens.ts) in sync with
 * the designer's source of truth (docs/design/tokens.json).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const design = JSON.parse(readFileSync(join(root, 'docs', 'design', 'tokens.json'), 'utf8'));
const app = readFileSync(join(root, 'apps', 'mobile', 'src', 'theme', 'tokens.ts'), 'utf8');

/** Asserts that `name: value` appears in tokens.ts with the design value. */
function expectValue(name, designKey) {
  const value = design[designKey];
  assert.notEqual(value, undefined, `missing design token ${designKey}`);
  const literal = typeof value === 'string' ? `'${value}'` : String(value);
  assert.ok(
    app.includes(`${name}: ${literal}`) || app.includes(`${name} = ${literal}`),
    `${name} should be ${literal} (${designKey})`,
  );
}

describe('design tokens in the app', () => {
  it('match the globe tokens', () => {
    expectValue('saturation', 'globe.final.raster.saturation');
    expectValue('contrast', 'globe.final.raster.contrast');
    expectValue('fadeDuration', 'globe.final.raster.fadeDuration');
    expectValue('brightnessMin', 'globe.final.raster.brightnessMin');
    expectValue('brightnessMax', 'globe.final.raster.brightnessMax');
    expectValue('oceanTint', 'globe.final.oceanTint');
    expectValue('oceanTintOpacity', 'globe.final.oceanTintOpacity');
    expectValue('oceanTintFadeStartZoom', 'globe.final.oceanTintFadeStartZoom');
    expectValue('oceanTintFadeEndZoom', 'globe.final.oceanTintFadeEndZoom');
    expectValue('borderWidthZ3', 'globe.final.borderWidthZ3');
    expectValue('borderWidthZ8', 'globe.final.borderWidthZ8');
    expectValue('borderDetailMinZoom', 'globe.final.borderDetailMinZoom');
    expectValue('color', 'globe.final.atmosphere.color');
    expectValue('highColor', 'globe.final.atmosphere.highColor');
    expectValue('horizonBlend', 'globe.final.atmosphere.horizonBlend');
    expectValue('spaceColor', 'globe.final.atmosphere.spaceColor');
    expectValue('starIntensity', 'globe.final.atmosphere.starIntensity');
    expectValue('baseOcean', 'globe.final.offline.ocean');
    expectValue('border', 'globe.final.border');
    expectValue('borderWidthZ0', 'globe.final.borderWidthZ0');
    expectValue('borderWidthZ5', 'globe.final.borderWidthZ5');
    expectValue('fillOpacity', 'globe.final.highlight.fillOpacity');
    expectValue('glowWidth', 'globe.final.highlight.glowWidth');
    expectValue('glowBlur', 'globe.final.highlight.glowBlur');
    expectValue('outline', 'globe.final.highlight.outline');
    expectValue('outlineWidth', 'globe.final.highlight.outlineWidth');
    expectValue('highlightColor', 'color.dark.region.default');
  });

  it('match the sprint 9 discovery tokens', () => {
    const block = app.slice(app.indexOf('discover: {'), app.indexOf('cityPin: {'));
    for (const [name, key] of [
      ['color', 'color'],
      ['fillOpacity', 'fillOpacity'],
      ['lineWidth', 'lineWidth'],
      ['dimOpacity', 'dim.opacity'],
      ['dimColor', 'dim.color'],
      ['ringRadius', 'ring.radius'],
    ]) {
      const value = design[`globe.final.discover.${key}`];
      const literal = typeof value === 'string' ? `'${value}'` : String(value);
      assert.ok(block.includes(`${name}: ${literal}`), `discover.${name} should be ${literal}`);
    }
    const pin = app.slice(app.indexOf('cityPin: {'), app.indexOf('searchScrim'));
    for (const key of ['radius', 'fill', 'strokeColor', 'zoom']) {
      const value = design[`globe.final.cityPin.${key}`];
      const literal = typeof value === 'string' ? `'${value}'` : String(value);
      assert.ok(pin.includes(`${key}: ${literal}`), `cityPin.${key} should be ${literal}`);
    }
    expectValue('discoverPanelPeek', 'layout.discover.panel.peek');
    expectValue('discoverChipsTop', 'layout.discover.chipsTop');
  });

  it('match the motion tokens', () => {
    expectValue('sheet', 'motion.duration.sheet');
    expectValue('highlight', 'motion.duration.highlight');
    expectValue('splitFlap', 'motion.duration.splitFlap');
    expectValue('flyToMin', 'motion.duration.flyToMin');
    expectValue('flyToMax', 'motion.duration.flyToMax');
    expectValue('reduceFadeOut', 'motion.duration.reduceFadeOut');
    expectValue('reduceFadeIn', 'motion.duration.reduceFadeIn');
    expectValue('autoRotateDegPerSec', 'motion.globe.autoRotateDegPerSec');
    expectValue('autoRotateResumeDelay', 'motion.globe.autoRotateResumeDelay');
    expectValue('autoRotateRamp', 'motion.globe.autoRotateRamp');
  });

  it('match the sprint 1 search and chrome tokens', () => {
    expectValue('searchScrim', 'globe.final.searchScrim');
    const scrim = app.slice(app.indexOf('systemScrim: {'), app.indexOf('searchScrim'));
    for (const key of ['color', 'opacityEdge', 'opacityInset', 'fadeLength', 'bottomFadeLength']) {
      const value = design[`globe.final.systemScrim.${key}`];
      const literal = typeof value === 'string' ? `'${value}'` : String(value);
      assert.ok(scrim.includes(`${key}: ${literal}`), `systemScrim.${key} should be ${literal}`);
    }
    const ring = app.slice(app.indexOf('selectionRing: {'), app.indexOf('searchScrim'));
    for (const [name, key] of [
      ['radius', 'radius'],
      ['width', 'width'],
      ['color', 'color'],
      ['underlayWidth', 'underlayWidth'],
      ['underlayColor', 'underlayColor'],
      ['underlayOpacity', 'underlayOpacity'],
    ]) {
      const value = design[`globe.final.selectionRing.${key}`];
      const literal = typeof value === 'string' ? `'${value}'` : String(value);
      assert.ok(ring.includes(`${name}: ${literal}`), `selectionRing.${name} should be ${literal}`);
    }
    expectValue('micro', 'motion.duration.micro');
    expectValue('medium', 'motion.duration.medium');
    expectValue('searchAnnounceDelay', 'motion.search.announceDelay');
    expectValue('toastVisible', 'motion.toast.visible');
    for (const scheme of ['light', 'dark']) {
      const block = app.slice(app.indexOf(`${scheme}: { bg:`));
      for (const part of ['bg', 'border', 'fg']) {
        const value = design[`brand.google.${scheme}.${part}`];
        assert.ok(
          block.startsWith(`${scheme}: { bg:`) && block.includes(`${part}: '${value}'`),
          `google ${scheme} ${part}`,
        );
      }
    }
    expectValue('touchTargetMin', 'size.touchTarget.min');
    expectValue('listRowMin', 'size.listRow.min');
    expectValue('chromeEdge', 'layout.chrome.edge');
    expectValue('chromeRowTop', 'layout.chrome.rowTop');
    expectValue('overlayTop', 'layout.chrome.overlayTop');
    expectValue('mapboxLogoTop', 'layout.mapbox.logoTop');
    expectValue('mapboxLogoLeft', 'layout.mapbox.logoLeft');
    expectValue('mapboxAttributionLeft', 'layout.mapbox.attributionLeft');
    expectValue('cardNameStepDownChars', 'layout.card.nameStepDownChars');
    expectValue('cardTileMinWidth', 'size.cardTile.minWidth');
    expectValue('cardTileMinHeight', 'size.cardTile.minHeight');
    expectValue('cardTileMaxWidthFew', 'size.cardTile.maxWidthFew');
    expectValue('cardTileGap', 'size.cardTile.gap');
    expectValue('cardTileBadge', 'size.cardTile.badge');
    expectValue('cardTilesListFromFontScale', 'layout.cardTiles.listFromFontScale');
    const light = app.slice(app.indexOf('light: {'), app.indexOf('dark: {'));
    const dark = app.slice(app.indexOf('dark: {'), app.indexOf('} as const;'));
    for (const [scheme, block] of [
      ['light', light],
      ['dark', dark],
    ]) {
      for (const [name, key] of [
        ['textTertiary', 'text.tertiary'],
        ['pressed', 'bg.pressed'],
        ['tag', 'bg.tag'],
        ['tilePressed', 'bg.tilePressed'],
        ['chromeBg', 'chrome.bg'],
        ['chromeFg', 'chrome.fg'],
        ['chromeBorder', 'chrome.border'],
        ['canvas', 'bg.canvas'],
        ['scrim', 'bg.scrim'],
        ['primary', 'action.primary.bg'],
        ['onPrimary', 'action.primary.fg'],
        ['secondaryBg', 'action.secondary.bg'],
        ['secondaryFg', 'action.secondary.fg'],
        ['disabledBg', 'action.disabled.bg'],
        ['disabledFg', 'action.disabled.fg'],
        ['infoBg', 'status.info.subtleBg'],
        ['infoFg', 'status.info.subtleFg'],
        ['link', 'text.link'],
        ['borderControl', 'border.control'],
      ]) {
        const value = design[`color.${scheme}.${key}`];
        assert.ok(block.includes(`${name}: '${value}'`), `${scheme} ${name} should be ${value}`);
      }
    }
  });

  it('match the card colours', () => {
    const light = app.slice(app.indexOf('light: {'), app.indexOf('dark: {'));
    const dark = app.slice(app.indexOf('dark: {'), app.indexOf('} as const;'));
    assert.ok(light.includes(`textPrimary: '${design['color.light.text.primary']}'`));
    assert.ok(light.includes(`textSecondary: '${design['color.light.text.secondary']}'`));
    assert.ok(dark.includes(`textPrimary: '${design['color.dark.text.primary']}'`));
    assert.ok(dark.includes(`textSecondary: '${design['color.dark.text.secondary']}'`));
    assert.ok(dark.includes(`surfaceRaised: '${design['color.dark.bg.surfaceRaised']}'`));
    assert.ok(dark.includes(`surface: '${design['color.dark.bg.surface']}'`));
    assert.ok(light.includes(`surface: '${design['color.light.bg.surface']}'`));
  });

  it('match the sprint 2 tokens (0.3.0)', () => {
    const trips = app.slice(app.indexOf('trips: {'), app.indexOf('searchScrim'));
    for (const [name, key] of [
      ['color', 'color'],
      ['fillOpacity', 'fillOpacity'],
      ['lineWidth', 'lineWidth'],
      ['underlayColor', 'underlayColor'],
      ['underlayOpacity', 'underlayOpacity'],
      ['underlayWidth', 'underlayWidth'],
      ['ringRadius', 'ring.radius'],
      ['ringWidth', 'ring.width'],
      ['ringUnderlayWidth', 'ring.underlayWidth'],
    ]) {
      const value = design[`globe.final.trips.${key}`];
      const literal = typeof value === 'string' ? `'${value}'` : String(value);
      assert.ok(trips.includes(`${name}: ${literal}`), `trips.${name} should be ${literal}`);
    }
    const light = app.slice(app.indexOf('light: {'), app.indexOf('dark: {'));
    const dark = app.slice(app.indexOf('dark: {'), app.indexOf('} as const;'));
    for (const [scheme, block] of [
      ['light', light],
      ['dark', dark],
    ]) {
      for (const [name, key] of [
        ['surfaceAlt', 'bg.surfaceAlt'],
        ['ctaBg', 'action.cta.bg'],
        ['ctaFg', 'action.cta.fg'],
        ['ctaPressed', 'action.cta.pressed'],
        ['successSubtleBg', 'status.success.subtleBg'],
        ['successSubtleFg', 'status.success.subtleFg'],
        ['activeBar', 'status.active.bar'],
        ['textAlert', 'text.alert'],
        ['skeleton', 'skeleton'],
      ]) {
        const value = design[`color.${scheme}.${key}`];
        assert.ok(block.includes(`${name}: '${value}'`), `${scheme} ${name} should be ${value}`);
      }
    }
    expectValue('toastVisibleLong', 'motion.toast.visibleLong');
    expectValue('skeletonDelay', 'motion.skeleton.delay');
    expectValue('skeletonPulse', 'motion.skeleton.pulse');
    expectValue('tripNameMax', 'limits.trip.nameMax');
    expectValue('tripNotesMax', 'limits.trip.notesMax');
    expectValue('profileNameMax', 'limits.profile.nameMax');
    expectValue('tripNameCounterFrom', 'limits.trip.nameCounterFrom');
    expectValue('tripNotesCounterFrom', 'limits.trip.notesCounterFrom');
    expectValue('profileNameCounterFrom', 'limits.profile.nameCounterFrom');
    expectValue('tripSaveTimeout', 'timing.trip.saveTimeout');
    expectValue('accountDeleteTimeout', 'timing.account.deleteTimeout');
    expectValue('tripsButtonBottom', 'layout.tripsButton.bottom');
    expectValue('tripRowMin', 'size.tripRow.min');
    expectValue('dateFieldMinWidth', 'size.dateField.minWidth');
    expectValue('formBarHeight', 'size.formBar.height');
    expectValue('couponNotchRadius', 'layout.card.coupon.notchRadius');
  });

  it('match the sprint 12 launch tokens', () => {
    for (const [name, key] of [
      ['background', 'color.launch.background'],
      ['route', 'color.launch.route'],
      ['routeUnderlay', 'color.launch.routeUnderlay'],
      ['routeUnderlayOpacity', 'color.launch.routeUnderlayOpacity'],
      ['pin', 'color.launch.pin'],
      ['pinDotColor', 'color.launch.pinDot'],
      ['originColor', 'color.launch.origin'],
      ['iconFrame', 'layout.launch.iconFrame'],
      ['iconCircle', 'layout.launch.iconCircle'],
      ['viewBox', 'layout.launch.viewBox'],
      ['contentScale', 'layout.launch.contentScale'],
      ['originSize', 'layout.launch.originSize'],
      ['routeWidth', 'layout.launch.routeWidth'],
      ['routeUnderlayWidth', 'layout.launch.routeUnderlayWidth'],
      ['pinWidth', 'layout.launch.pinWidth'],
      ['pinHeight', 'layout.launch.pinHeight'],
      ['pinStroke', 'layout.launch.pinStroke'],
      ['pinDotSize', 'layout.launch.pinDotSize'],
      ['routePath', 'layout.launch.routePath'],
      ['routeLength', 'layout.launch.routeLength'],
      ['launchOrigin', 'motion.launch.originDuration'],
      ['launchRouteDelay', 'motion.launch.routeDelay'],
      ['launchRoute', 'motion.launch.routeDuration'],
      ['launchPinDelay', 'motion.launch.pinDelay'],
      ['launchPin', 'motion.launch.pinDuration'],
      ['launchCap', 'timing.launch.cap'],
      ['launchHideFallback', 'timing.launch.hideFallback'],
    ]) {
      expectValue(name, key);
    }
    const list = (key) => `[${design[key].join(', ')}]`;
    assert.ok(app.includes(`pinAt: ${list('layout.launch.pinAt')}`), 'launch.pinAt');
    for (const name of ['standard', 'flyTo', 'overshoot']) {
      assert.ok(app.includes(`${name}: ${list(`motion.easing.${name}`)}`), `easing.${name}`);
    }
  });
});
