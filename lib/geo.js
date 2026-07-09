
export function isLatitudeKey(key) {
  return /^(lat|latitude)$/i.test(String(key));
}

export function isLongitudeKey(key) {
  return /^(lon|lng|long|longitude)$/i.test(String(key));
}

export function parseCoordNumber(value) {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

export function isValidLatitude(n) {
  return n !== null && n >= -90 && n <= 90;
}

export function isValidLongitude(n) {
  return n !== null && n >= -180 && n <= 180;
}

export function isBoundaryLatitude(n) {
  return n === 90 || n === -90;
}

export function isBoundaryLongitude(n) {
  return n === 180 || n === -180;
}
