// controllers/resources.controller.ts
import { Request, Response } from "express";
import { fetchFromTable } from "../services/bq.service";

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
  const suite = pick(["suite", "resource_name"]);
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

  const hasUserFilter = Object.keys(filters).some(
    (k) => !["extraction_date", "resource_type"].includes(k)
  );

  const defaultLimit = Math.min(Number(q.limit ?? 50), 200);
  const limit: number | undefined = hasUserFilter
    ? undefined
    : q.limit === "all"
    ? undefined
    : defaultLimit;

  const offset = limit ? Math.max(Number(q.offset ?? 0), 0) : 0;

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

  const defaultLimit = Math.min(Number(q.limit ?? 50), 200);
  const limit: number | undefined =
    q.limit === "all" ? undefined : defaultLimit;
  const today = new Date().toISOString().split("T")[0];
  const offset = limit ? Math.max(Number(q.offset ?? 0), 0) : 0;

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

  const defaultLimit = Math.min(Number(q.limit ?? 50), 200);
  const limit: number | undefined =
    q.limit === "all" ? undefined : defaultLimit;
  const today = new Date().toISOString().split("T")[0];
  const offset = limit ? Math.max(Number(q.offset ?? 0), 0) : 0;

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
