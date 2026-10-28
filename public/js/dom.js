// Tiny DOM helpers: build elements without innerHTML, so data is never parsed as HTML.
import { intlLocale } from './i18n.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** replaceChildren() that skips null, undefined and false like h(), instead of printing them. */
export function setChildren(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

export const formatDayTime = (ms) => {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day} ${time}`;
};

export function formatDistance(m) {
  if (m < 1000) return `${new Intl.NumberFormat(intlLocale()).format(Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} km`;
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function navigationUrl(lat, lon) {
  return isIOS()
    ? `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
}
