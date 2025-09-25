export function parseLimit(raw: any, hardCap = 200): number | undefined {  // parse the limit (prevents users from requesting too many rows)
  if (raw === undefined || raw === null) return undefined; // no limit by default (default is 200)
  if (String(raw).toLowerCase() === "all") return undefined; // explicit all
  const n = Number(raw); // convert the limit to a number
  if (!Number.isFinite(n) || n <= 0) return undefined; // if the limit is not a number or is less than or equal to 0, return undefined
  return Math.min(Math.floor(n), hardCap); // return the limit, but not greater than the hard cap
}
