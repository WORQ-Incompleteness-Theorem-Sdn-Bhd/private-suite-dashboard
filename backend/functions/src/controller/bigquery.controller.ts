// controllers/resources.controller.ts
import { Request, Response } from "express";
import { fetchFromTable, queryRows } from "../services/bq.service";
import { parseLimit } from "../utils/bigquery.utils";
export async function getResources(req: Request, res: Response): Promise<void> {
  const q = req.query ?? {};
  const b = (req.body ?? {}) as Record<string, any>;

  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = (q as any)[k] ?? b[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return undefined;
  };

  const outlet = pick(["outlet", "office_id"]);
  const status = pick(["status"]);
  const pax = pick(["pax", "pax_size"]);
  const suite = pick(["suite", "resource_id"]); 
  const floorId = pick(["floor", "floor_id"]);
  const resourceTypeOverride = pick(["resource_type"]);

  const today = new Date().toISOString().split("T")[0];

  const filters: Record<string, any> = {
    extraction_date: today,
    ...(resourceTypeOverride
      ? { resource_type: String(resourceTypeOverride) }
      : { resource_type: "team_room" }),
    ...(outlet ? { office_id: String(outlet) } : {}),
    ...(status ? { status: String(status) } : {}),
    ...(pax ? { pax_size: Number(pax) } : {}),
    ...(suite ? { resource_id: String(suite) } : {}),
    ...(floorId ? { floor_id: String(floorId) } : {}),
  };

  const limit = parseLimit(q.limit, 200);
  const offset =
    typeof limit === "number" ? Math.max(Number(q.offset ?? 0), 0) : 0;

  try {
    const rows = await fetchFromTable({
      limit,
      offset,
      allowedSelect: [
        "extraction_date",
        "resource_id",
        "resource_type",
        "resource_name",
        "price",
        "deposit",
        "resource_number",
        "pax_size",
        "area_in_sqmm",
        "status",
        "office_id",
        "floor_id",
        "available_from",
        "available_until",
        "youtube_link",
      ],
      allowedFilter: [
        "extraction_date",
        "office_id",
        "status",
        "pax_size",
        "resource_id",
        "floor_id",
        "resource_type",
      ],
      filters,
      table: process.env.BQ_RESOURCE_TABLE_ID,
    });

    res.json({
      data: rows,
      limit: limit || undefined,
      offset: limit ? offset : undefined,
      filtersApplied: filters,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("Access Denied")) {
      res.status(403).json({ error: "BigQuery access denied" });
      return;
    }
    if (msg.includes("location")) {
      res
        .status(400)
        .json({ error: "Region mismatch. Check BIGQUERY_LOCATION." });
      return;
    }
    console.error("[getResources]", msg);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export async function getLocations(req: Request, res: Response): Promise<void> {
  const q = req.query ?? {};

  const limit = parseLimit(q.limit, 200);
  const offset =
    typeof limit === "number" ? Math.max(Number(q.offset ?? 0), 0) : 0;

  const today = new Date().toISOString().split("T")[0];

  try {
    const projectId = process.env.BIGQUERY_PROJECT_ID!;
    const datasetId = process.env.BIGQUERY_DATASET_ID!;
    const tableId = process.env.BQ_LOCATION_TABLE_ID!;
    const tableFQN = `\`${projectId}.${datasetId}.${tableId}\``;

    const baseSql = `
      SELECT extraction_date, location_id, location_name
      FROM ${tableFQN}
      WHERE extraction_date = @today
        AND location_id IS NOT NULL
        AND location_id != @excluded_id
    `;

    const sql =
      typeof limit === "number"
        ? `${baseSql}\nLIMIT @limit OFFSET @offset`
        : baseSql;

    const rows = await queryRows({
      sql,
      params: {
        today,
        excluded_id: "5e97e43db77c8a004526efa8",
        ...(typeof limit === "number"
          ? { limit: Math.min(limit, 1000), offset }
          : {}),
      },
      location: process.env.BIGQUERY_LOCATION || "asia-southeast1",
    });

    res.json({
      data: rows,
      limit: limit || undefined,
      offset: limit ? offset : undefined,
      filtersApplied: undefined,
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("Access Denied")) {
      res.status(403).json({ error: "BigQuery access denied" });
      return;
    }
    if (msg.includes("location")) {
      res
        .status(400)
        .json({ error: "Region mismatch. Check BIGQUERY_LOCATION." });
      return;
    }
    console.error("[getLocations]", msg);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export async function getFloors(req: Request, res: Response): Promise<void> {
  const q = req.query ?? {};

  const today = new Date().toISOString().split("T")[0];
  const limit = parseLimit(q.limit, 200);
  const offset =
    typeof limit === "number" ? Math.max(Number(q.offset ?? 0), 0) : 0;

  try {
    
    // Debug: show fetchFromTable inputs
    console.log('[getFloors] fetchFromTable inputs:', {
      limit,
      offset,
      allowedSelect: ["extraction_date", "floor_id", "floor_no", "floor_name", "location_id"],
      allowedFilter: ["extraction_date"],
      filters: { extraction_date: today },
      table: process.env.BQ_FLOOR_TABLE_ID,
    });

    const rows = await fetchFromTable({
      limit,
      offset,
      allowedSelect: ["extraction_date", "floor_id", "floor_no", "floor_name", "location_id"],
      allowedFilter: ["extraction_date"],
      filters: {
        extraction_date: today,
      },
      table: process.env.BQ_FLOOR_TABLE_ID,
    });

    // Return rows to avoid unused variable warning and provide API response
    res.json({
      data: rows,
      limit: limit || undefined,
      offset: limit ? offset : undefined,
      filtersApplied: { extraction_date: today },
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("Access Denied")) {
      res.status(403).json({ error: "BigQuery access denied" });
      return;
    }
    if (msg.includes("location")) {
      res
        .status(400)
        .json({ error: "Region mismatch. Check BIGQUERY_LOCATION." });
      return;
    }
    console.error("[getFloors]", msg);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

const TZ = "Asia/Kuala_Lumpur";

const BQ_PROJECT = process.env.BIGQUERY_PROJECT_ID!;
const BQ_DATASET = process.env.BIGQUERY_DATASET_ID!;
const TBL_RES = process.env.BQ_RESOURCE_TABLE_ID!;
const TBL_MEMBERS = process.env.BQ_MEMBERSHIP_TABLE_ID!;

const RES_FQN = `\`${BQ_PROJECT}.${BQ_DATASET}.${TBL_RES}\``;
const MEM_FQN = `\`${BQ_PROJECT}.${BQ_DATASET}.${TBL_MEMBERS}\``;

export async function getAvailability(req: Request, res: Response) {
  try {
    // Inputs
    const startStr = String(req.query.start || "");
    const endStr = String(req.query.end || "");
    const officeId =
      req.query.office_id ?? req.query.outlet
        ? String(req.query.office_id ?? req.query.outlet)
        : undefined;

    if (!startStr || !endStr) {
      return res
        .status(400)
        .json({ error: "start and end are required (YYYY-MM-DD)" });
    }

    // Basic validation
    const startD = new Date(startStr + "T00:00:00Z");
    const endD = new Date(endStr + "T00:00:00Z");
    if (isNaN(+startD) || isNaN(+endD) || endD < startD) {
      return res.status(400).json({ error: "Invalid date range" });
    }
    const dayCount = Math.round((+endD - +startD) / 86400000) + 1; // inclusive
    // Allow up to 366 days to account for inclusive end date and leap years
    if (dayCount > 366) {
      return res.status(400).json({ error: "Range too large (<= 366 days)" });
    }

    const toISODate = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);

    const startISO = toISODate(startD);
    const endISO = toISODate(endD);
    const todayISO = toISODate(new Date());

    const sql = `
      DECLARE range_start   DATE   DEFAULT @range_start;
      DECLARE range_end     DATE   DEFAULT @range_end;
      DECLARE office_id_p   STRING DEFAULT @office_id;  

      WITH params AS (
        SELECT range_start, range_end
      ),
      days AS (
        SELECT d AS day FROM params, UNNEST(GENERATE_DATE_ARRAY(range_start, range_end))
      ),
      resources AS (
        SELECT DISTINCT resource_id, resource_name AS name, office_id
        FROM ${RES_FQN}
        WHERE extraction_date = @today
          AND resource_type = 'team_room'
          AND (office_id_p IS NULL OR office_id = office_id_p)
      ),
     memberships AS (
  SELECT
    resource_id,
    DATE(start_date) AS start_date,                          
    COALESCE(DATE(end_date), DATE '9999-12-31') AS end_date  
  FROM ${MEM_FQN}
  WHERE extraction_date = @today
  
),

      grid AS (
        SELECT r.resource_id, r.name, d.day
        FROM resources r
        CROSS JOIN days d
      ),
      overlaps AS (
        SELECT g.resource_id, g.day
        FROM grid g
        JOIN memberships m
          ON m.resource_id = g.resource_id
         AND g.day BETWEEN m.start_date AND m.end_date
        GROUP BY g.resource_id, g.day
      )
      SELECT
        g.resource_id,
        ANY_VALUE(g.name) AS name,
        ARRAY_AGG(STRUCT(
          g.day AS date,
          IF(o.resource_id IS NULL, 'free', 'occupied') AS status
        ) ORDER BY g.day) AS days
      FROM grid g
      LEFT JOIN overlaps o
        ON g.resource_id = o.resource_id AND g.day = o.day
      GROUP BY g.resource_id
      ORDER BY g.resource_id
    `;

    const rows = await queryRows({
      sql,
      params: {
        range_start: startISO,
        range_end: endISO,
        office_id: officeId,
        today: todayISO,
      },
      location: "asia-southeast1",
    });

    return res.json({
      range: { start: startISO, end: endISO, tz: TZ },
      office_id: officeId,
      resource_type: "team_room",
      resources: rows,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("Access Denied")) {
      return res.status(403).json({ error: "BigQuery access denied" });
    }
    if (msg.includes("location")) {
      return res
        .status(400)
        .json({ error: "Region mismatch. Check BIGQUERY_LOCATION." });
    }
    console.error("[getAvailability]", msg);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}


