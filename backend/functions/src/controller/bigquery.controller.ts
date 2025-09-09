// controllers/resources.controller.ts
import { Request, Response } from "express";
import { fetchFromTable } from "../services/bq.service";
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
  const suite = pick(["suite", "resource_name"]); //tukar id
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
    ...(suite ? { resource_name: String(suite) } : {}),
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
        "resource_name",
        "floor_id",
        "resource_type",
      ],
      filters,
      table: process.env.BQ_RESOURCE_TABLE_ID,
    });

    res.json({
      data: rows,
      limit: limit ?? null,
      offset: limit ? offset : null,
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
    const rows = await fetchFromTable({
      limit,
      offset,
      allowedSelect: ["extraction_date", "location_id", "location_name"],
      allowedFilter: ["extraction_date"],
      filters: {
        extraction_date: today,
      },
      table: process.env.BQ_LOCATION_TABLE_ID,
    });

    res.json({
      data: rows,
      limit: limit ?? null,
      offset: limit ? offset : null,
      filtersApplied: null,
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
    const rows = await fetchFromTable({
      limit,
      offset,
      allowedSelect: ["extraction_date", "floor_id", "floor_no", "floor_name"],
      allowedFilter: ["extraction_date"],
      filters: {
        extraction_date: today,
      },
      table: process.env.BQ_FLOOR_TABLE_ID,
    });

    res.json({
      data: rows,
      limit: limit ?? null,
      offset: limit ? offset : null,
      filtersApplied: null,
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

export async function getMemberships(
  req: Request,
  res: Response
): Promise<void> {
  const q = req.query ?? {};
  const b = (req.body ?? {}) as Record<string, any>;

  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = (q as any)[k] ?? b[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return undefined;
  };

  const resourceId = pick(["resource_id"]);
  const status = pick(["status"]);
  const memberId = pick(["membership_id"]);
  const today = new Date().toISOString().split("T")[0];

  const limit = parseLimit(q.limit, 200);
  const offset =
    typeof limit === "number" ? Math.max(Number(q.offset ?? 0), 0) : 0;

  try {
    const rows = await fetchFromTable({
      limit,
      offset,
      allowedSelect: [
        "extraction_date",
        "membership_id",
        "resource_id",
        "status",
        "start_date",
        "end_date",
      ],
      allowedFilter: [
        "extraction_date",
        "resource_id",
        "status",
        "membership_id",
        "extraction_date",
      ],
      filters: {
        ...(resourceId ? { resource_id: String(resourceId) } : {}),
        ...(status ? { status: String(status) } : {}),
        ...(memberId ? { membership_id: String(memberId) } : {}),
        extraction_date: today,
      },
      table: process.env.BQ_MEMBERSHIP_TABLE_ID,
    });

    res.json({
      data: rows,
      limit: limit ?? null,
      offset: limit ? offset : null,
      filtersApplied: {
        resource_id: resourceId ?? null,
        status: status ?? null,
        membership_id: memberId ?? null,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("Access Denied"))
      return void res.status(403).json({ error: "BigQuery access denied" });
    if (msg.includes("location"))
      return void res
        .status(400)
        .json({ error: "Region mismatch. Check BIGQUERY_LOCATION." });
    console.error("[getMemberships]", msg);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
