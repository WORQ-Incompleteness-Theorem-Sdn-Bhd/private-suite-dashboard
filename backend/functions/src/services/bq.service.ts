import { bq } from "../clients/bq-client"; //BigQuery client

//Function to fetch data from BigQuery
//Fetches data from BigQuery tables with built-in SQL injection protection
//Supports filtering, pagination, and column selection
//Enforces security through allowlists for columns and filters

type Filters = Record<string, string | number | boolean>; //Filters for BigQuery

interface FetchOptions { //Options for BigQuery
  dataset?: string; //Dataset for BigQuery
  table?: string; //Table for BigQuery
  select?: string[]; //Select for BigQuery
  filters?: Filters; //Filters for BigQuery

  allowedSelect?: string[]; //Allowed select for BigQuery
  allowedFilter?: string[]; //Allowed filter for BigQuery
  location?: string; //Location for BigQuery
  dataProjectId?: string; //Data project id for BigQuery

  limit?: number; //Limit for BigQuery
  offset?: number; //Offset for BigQuery
}

export async function fetchFromTable(opts: FetchOptions) { //Fetch from table
  const {
    dataset = process.env.BIGQUERY_DATASET_ID || "", //Dataset for BigQuery
    table = "", //Table for BigQuery
    select = ["*"], //Select for BigQuery
    filters = {}, //Filters for BigQuery

    allowedSelect = [], //Allowed select for BigQuery
    allowedFilter = [], //Allowed filter for BigQuery
    location = process.env.BIGQUERY_LOCATION || "asia-southeast1", //Location for BigQuery
    dataProjectId = process.env.BIGQUERY_PROJECT_ID || "", //Data project id for BigQuery

    limit, //Limit for BigQuery
    offset, //Offset for BigQuery
  } = opts; 

  if (!dataProjectId) throw new Error("Missing data project id"); //Missing data project id
  if (!dataset) throw new Error("Missing dataset id"); //Missing dataset id
  if (!table) throw new Error("Missing table id"); //Missing table id

  // --- Safe SELECT ---
  let safeSelect: string; //Safe select for BigQuery
  if (allowedSelect.length > 0) { //Allowed select for BigQuery
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
