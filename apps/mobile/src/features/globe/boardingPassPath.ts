/**
 * SVG outline of the boarding-pass card: a rounded rectangle with two
 * half-circle "punch holes" cut into the top and bottom edges where the stub
 * is torn off. The holes are real cut-outs, so the globe shows through them.
 *
 * With `couponY` (sprint 2 design 2.1), the card has a coupon below: a notch
 * on each side at that height, and the stub's bottom hole goes away, since
 * the stub ends at the coupon line.
 */
export function boardingPassPath(
  width: number,
  height: number,
  {
    cornerRadius,
    notchX,
    notchRadius,
    couponY,
  }: { cornerRadius: number; notchX: number; notchRadius: number; couponY?: number },
): string {
  const r = cornerRadius;
  const n = notchRadius;
  // Every edge is drawn clockwise, so sweep 0 always bends into the card.
  if (couponY !== undefined) {
    return [
      `M ${r} 0`,
      `L ${notchX - n} 0`,
      `A ${n} ${n} 0 0 0 ${notchX + n} 0`,
      `L ${width - r} 0`,
      `A ${r} ${r} 0 0 1 ${width} ${r}`,
      `L ${width} ${couponY - n}`,
      `A ${n} ${n} 0 0 0 ${width} ${couponY + n}`,
      `L ${width} ${height - r}`,
      `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
      `L ${r} ${height}`,
      `A ${r} ${r} 0 0 1 0 ${height - r}`,
      `L 0 ${couponY + n}`,
      `A ${n} ${n} 0 0 0 0 ${couponY - n}`,
      `L 0 ${r}`,
      `A ${r} ${r} 0 0 1 ${r} 0`,
      'Z',
    ].join(' ');
  }
  return [
    `M ${r} 0`,
    `L ${notchX - n} 0`,
    // sweep 0 bends the arc down, into the card: a cut-out, not a bump
    `A ${n} ${n} 0 0 0 ${notchX + n} 0`,
    `L ${width - r} 0`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `L ${width} ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `L ${notchX + n} ${height}`,
    `A ${n} ${n} 0 0 0 ${notchX - n} ${height}`,
    `L ${r} ${height}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}
