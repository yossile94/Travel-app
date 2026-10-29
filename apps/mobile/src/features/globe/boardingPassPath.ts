/**
 * SVG outline of the boarding-pass card: a rounded rectangle with two
 * half-circle "punch holes" cut into the top and bottom edges where the stub
 * is torn off. The holes are real cut-outs, so the globe shows through them.
 *
 * With tear lines (`tearYs`: the tiles' strip, then the coupon; sprint 2
 * design 2.1, fix-country-card 3), the card has a notch on each side at each
 * line, and the stub's bottom hole goes away, since the stub ends at the first
 * line.
 */
export function boardingPassPath(
  width: number,
  height: number,
  {
    cornerRadius,
    notchX,
    notchRadius,
    tearYs = [],
  }: { cornerRadius: number; notchX: number; notchRadius: number; tearYs?: readonly number[] },
): string {
  const r = cornerRadius;
  const n = notchRadius;
  const lines = [...tearYs].sort((a, b) => a - b);
  // Every edge is drawn clockwise, so sweep 0 always bends into the card.
  const top = [
    `M ${r} 0`,
    `L ${notchX - n} 0`,
    // sweep 0 bends the arc down, into the card: a cut-out, not a bump
    `A ${n} ${n} 0 0 0 ${notchX + n} 0`,
    `L ${width - r} 0`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
  ];
  // Down the end side, a notch at each line.
  const endSide = lines.flatMap((y) => [
    `L ${width} ${y - n}`,
    `A ${n} ${n} 0 0 0 ${width} ${y + n}`,
  ]);
  const bottom = [
    `L ${width} ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    ...(lines.length
      ? []
      : [`L ${notchX + n} ${height}`, `A ${n} ${n} 0 0 0 ${notchX - n} ${height}`]),
    `L ${r} ${height}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
  ];
  // Up the start side, the same notches from the bottom.
  const startSide = [...lines]
    .reverse()
    .flatMap((y) => [`L 0 ${y + n}`, `A ${n} ${n} 0 0 0 0 ${y - n}`]);
  return [
    ...top,
    ...endSide,
    ...bottom,
    ...startSide,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}
