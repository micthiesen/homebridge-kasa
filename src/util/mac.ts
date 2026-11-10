function normalizeMac(mac: string): string {
  return mac.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Glob-style MAC match (`?` one character, `*` any run), ignoring case and
 * separators. Mirrors `compareMac` in tplink-smarthome-api, which does not
 * export it, so both discovery paths treat the same config identically.
 */
export function macMatches(mac: string, patterns: readonly string[]): boolean {
  const normalized = normalizeMac(mac);
  return patterns.some((pattern) => {
    const source = pattern
      .replace(/[^A-Za-z0-9?*]/g, "")
      .replace(/[?]/g, ".")
      .replace(/[*]/g, ".*")
      .toUpperCase();
    return new RegExp(`^${source}$`).test(normalized);
  });
}
