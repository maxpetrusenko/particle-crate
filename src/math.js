export const rand = (min, max) => min + Math.random() * (max - min);
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function bodyHull(body) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const corners = [
    [-body.w / 2, -body.h / 2],
    [body.w / 2, -body.h / 2],
    [body.w / 2, body.h / 2],
    [-body.w / 2, body.h / 2],
  ];

  return corners.map(([x, y]) => ({
    x: body.x + x * cos - y * sin,
    y: body.y + x * sin + y * cos,
  }));
}
