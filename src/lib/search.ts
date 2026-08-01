const ORDER_ID_SEARCH_RE = /^[A-Z]{1,5}-\d+$/i;

export function normalizeOrderIdSearch(value: string) {
  return value.trim().replace(/^#/, "").toUpperCase();
}

export function isOrderIdSearch(value: string) {
  return ORDER_ID_SEARCH_RE.test(normalizeOrderIdSearch(value));
}

export function exactOrderIdMatch(value: string | null | undefined, search: string) {
  return normalizeOrderIdSearch(value || "") === normalizeOrderIdSearch(search);
}
