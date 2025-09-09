export function parseLimit(raw: any, hardCap = 200): number | undefined {
  if (raw === undefined || raw === null) return undefined; // no limit by default
  if (String(raw).toLowerCase() === "all") return undefined; // explicit all
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), hardCap);
}
