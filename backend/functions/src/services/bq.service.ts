import { bq } from "../bq-client";

type Filters = Record<string, string | number | boolean>;

interface FetchOptions {
  dataset?: string;
  table?: string;
  select?: string[];
  filters?: Filters;

  allowedSelect?: string[];
  allowedFilter?: string[];
  location?: string;
  dataProjectId?: string;

  limit?: number;
  offset?: number;
}

export async function fetchFromTable(opts: FetchOptions) {
  const {
    dataset = process.env.BIGQUERY_DATASET_ID || "",
    table = "",
    select = ["*"],
    filters = {},

    allowedSelect = [],
    allowedFilter = [],
    location = process.env.BIGQUERY_LOCATION || "asia-southeast1",
    dataProjectId = process.env.BIGQUERY_PROJECT_ID || "",

    limit,
    offset,
  } = opts;

  if (!dataProjectId) throw new Error("Missing data project id");
  if (!dataset) throw new Error("Missing dataset id");
  if (!table) throw new Error("Missing table id");

  // --- Safe SELECT ---
  let safeSelect: string;
  if (allowedSelect.length > 0) {
    const picked =
      select[0] === "*"
        ? allowedSelect
        : select.filter((c) => allowedSelect.includes(c));
    safeSelect = picked.length
      ? picked.map((c) => `\`${c}\``).join(", ")
      : allowedSelect.map((c) => `\`${c}\``).join(", ");
  } else {
    safeSelect =
      select.length === 1 && select[0] === "*"
        ? "*"
        : select.map((c) => `\`${c}\``).join(", ") || "*";
  }

  // --- WHERE ---
  const whereParts: string[] = [];
  const params: Record<string, any> = {};
  let paramIndex = 0;

  for (const [key, value] of Object.entries(filters)) {
    if (allowedFilter.length > 0 && !allowedFilter.includes(key)) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const p = `p_${paramIndex++}`;
    whereParts.push(`\`${key}\` = @${p}`);
    params[p] = value;
  }
  const whereClause = whereParts.length
    ? `WHERE ${whereParts.join(" AND ")}`
    : "";

  // --- LIMIT / OFFSET ---
  let limitOffsetClause = "";
  if (typeof limit === "number" && limit > 0) {
    const safeLimit = Math.min(limit, 1000);
    const safeOffset = Number.isFinite(offset) && offset! >= 0 ? offset : 0;
    limitOffsetClause = `LIMIT @limit OFFSET @offset`;
    params.limit = safeLimit;
    params.offset = safeOffset;
  }

  // --- Query ---
  const tableFQN = `\`${dataProjectId}.${dataset}.${table}\``;

  const query = `
    SELECT ${safeSelect}
    FROM ${tableFQN}
    ${whereClause}
    ${limitOffsetClause}
  `.trim();

  const [job] = await bq.createQueryJob({
    query,
    location,
    params,
  });

  const [rows] = await job.getQueryResults();
  return rows;
}

export async function queryRows(opts: {
  sql: string;
  params?: Record<string, any>;
  location?: string;
}): Promise<any[]> {
  const [job] = await bq.createQueryJob({
    query: opts.sql,
    params: opts.params ?? {},
    location:
      opts.location || process.env.BIGQUERY_LOCATION || "asia-southeast1",
  });

  const [rows] = await job.getQueryResults();
  return rows as any[];
}
