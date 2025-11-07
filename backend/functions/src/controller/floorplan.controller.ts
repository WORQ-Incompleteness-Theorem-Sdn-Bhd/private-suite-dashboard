// controllers/floorplans.controller.ts
import { Request, Response } from "express";
import { Storage, File, Bucket, GetFilesOptions } from "@google-cloud/storage";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  initializeStorage,
  parseMultipartFromStream,
  parseMultipartFromRawBody,
  sanitizeBaseName,
  clampInt,
} from "../utils/floorplan.util";

/** CONFIG */
// Use firebasestorage.app format (matches user's Firebase Storage URL)
const BUCKET = process.env.FLOORPLAN_BUCKET || 'floorplan-dashboard-2a468.firebasestorage.app';
const ROOT_PREFIX = process.env.FLOORPLAN_ROOT_PREFIX || ''; // Empty = root level, 'floorplans' = under floorplans folder

console.log('🔧 Backend Config:', { BUCKET, ROOT_PREFIX, ROOT_PREFIX_EMPTY: ROOT_PREFIX === '' });

const storage: Storage = initializeStorage();
const bucket = storage.bucket(BUCKET);

/** Main upload handler for Firebase Functions */
export async function handleUpload(req: Request, res: Response): Promise<void> {
  console.log("➡️ Upload request received in Firebase Functions");

  let tempFilePath: string | null = null;
  let cloudFile: File | null = null;

  const cleanup = async () => {
    try {
      if (tempFilePath) {
        await fs.unlink(tempFilePath).catch(() => { });
      }
      if (cloudFile) {
        await (cloudFile as File).delete().catch(() => { });
      }
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  };

  try {
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      if ((req as any).readableEnded)
        throw new Error("Request stream already consumed");
      const { fields, file } = await parseMultipartFromStream(req);
      return await processUpload(fields, file, res, cleanup);
    }

    console.log("📦 Using rawBody for parsing");
    const { fields, file } = await parseMultipartFromRawBody(
      rawBody,
      req.headers["content-type"] as string
    );

    await processUpload(fields, file, res, cleanup);
  } catch (error: any) {
    console.error("❌ Upload error:", error?.message || error);
    console.error("❌ Upload error stack:", error?.stack);
    console.error("❌ Upload error code:", error?.code);
    console.error("❌ Upload error status:", error?.status);
    await cleanup();
    res.status(500).json({
      error: "Upload failed",
      details: String(error?.message || error) ?? undefined,
    });
  }
}

/** Process the upload after parsing */
async function processUpload(
  fields: Record<string, string>,
  file: { buffer: Buffer; filename: string; size: number } | null,
  res: Response,
  cleanup: () => Promise<void>
) {
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  if (!file.filename.toLowerCase().endsWith(".svg")) {
    res.status(400).json({ error: "Only SVG files are allowed" });
    return;
  }

  const officeId = fields.officeId || fields.office_id;
  const floorId = fields.floorId || fields.floor_id;
  const overwrite =
    String(fields.overwrite || "false").toLowerCase() === "true";

  const fileName =
    fields.fileName || fields.filename || file.filename.replace(/\.svg$/i, "");

  // Debug logging
  console.log("📤 Upload fields received:", {
    officeId,
    floorId,
    overwrite,
    fileName,
    fileSize: file.size,
    fileType: file.filename
  });

  if (!officeId) {
    console.error("❌ Missing officeId in upload request");
    res.status(400).json({ error: "officeId is required" });
    return;
  }

  const tempId = randomUUID();
  const tmp = path.join(os.tmpdir(), `upload-${tempId}.svg`);
  await fs.writeFile(tmp, file.buffer);

  try {
    // Build final destination key
    const sanitizedName = (sanitizeBaseName(fileName) || "floorplan") + ".svg";
    const prefix = ROOT_PREFIX ? `${ROOT_PREFIX}/` : '';
    const finalKey = floorId
      ? `${prefix}${officeId}/${floorId}/${sanitizedName}`
      : `${prefix}${officeId}/${sanitizedName}`;

    console.log("🎯 Upload target path:", finalKey);
    console.log("📁 Office ID:", officeId);
    console.log("🏢 Floor ID:", floorId || "none (office-level)");
    console.log("🔄 Overwrite mode:", overwrite);

    // Only check exact target file; folders are virtual and auto-created
    const targetFile = bucket.file(finalKey);
    console.log("🔍 Checking if target file exists...");
    const [exists] = await targetFile.exists();
    console.log("📄 Target file exists:", exists);
    if (exists && !overwrite) {
      await fs.unlink(tmp).catch(() => { });
      res.status(409).json({
        error: "SVG already exists for this location. Pass overwrite=true to replace.",
        existing: [finalKey],
      });
      return;
    }
    if (exists && overwrite) {
      await targetFile.delete({ ignoreNotFound: true }).catch(() => { });
    }

    // 3) Upload the new file
    console.log("☁️ Uploading to:", finalKey);
    console.log("🚀 Starting Firebase Storage upload...");
    await bucket.upload(tmp, {
      destination: finalKey,
      resumable: false,
      contentType: "image/svg+xml",
      metadata: {
        metadata: {
          officeId,
          ...(floorId ? { floorId } : {}),
          originalName: file.filename,
        },
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    console.log("✅ Upload completed successfully!");

    // Only now set cloudFile for potential cleanup-on-error
    const cloudFile = bucket.file(finalKey);

    // 4) Try to sign a URL (optional)
    try {
      const minutes = 60;
      const [signedUrl] = await cloudFile.getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + minutes * 60 * 1000,
      });
      await fs.unlink(tmp).catch(() => { });
      res.status(201).json({
        ok: true,
        bucket: BUCKET,
        path: finalKey,
        signedUrl,
        metadata: {
          originalName: file.filename,
          size: file.size,
          uploadId: tempId,
          overwrote: overwrite || undefined,
        },
      });
    } catch (signError: any) {
      console.error(
        "Signed URL generation failed:",
        signError?.message || signError
      );
      await fs.unlink(tmp).catch(() => { });
      res.status(201).json({
        ok: true,
        bucket: BUCKET,
        path: finalKey,
        signedUrl: null,
        signedUrlError: "Failed to generate signed URL",
        metadata: {
          originalName: file.filename,
          size: file.size,
          uploadId: tempId,
          overwrote: overwrite || undefined,
        },
      });
    } finally {
      await cleanup();
    }
  } catch (err: any) {
    console.error("❌ Upload processing error:", err?.message || err);
    console.error("❌ Error stack:", err?.stack);
    console.error("❌ Error code:", err?.code);
    console.error("❌ Error status:", err?.status);
    await fs.unlink(tmp).catch(() => { });
    await cleanup();
    res.status(500).json({
      error: "Upload failed during processing",
      details: String(err?.message || err) ?? undefined,
    });
  }
}

/** GET /api/floorplans/:officeId[/:floorId] */
async function fetchAllSvgs(bucket: Bucket, prefix: string): Promise<File[]> {
  try {
    console.log(`🔍 fetchAllSvgs: Searching for SVG files at prefix: "${prefix}"`);
    console.log(`🔍 fetchAllSvgs: Bucket name: "${bucket.name}"`);
    console.log(`🔍 fetchAllSvgs: Search options: prefix="${prefix}", no delimiter (recursive)`);
    
    const opts: GetFilesOptions = {
      prefix,            // recursive search (no delimiter)
      autoPaginate: true
    };
    
    console.log(`🔍 fetchAllSvgs: Calling bucket.getFiles()...`);
    const [allFiles] = await bucket.getFiles(opts);
    console.log(`📁 fetchAllSvgs: Found ${allFiles.length} total files at prefix "${prefix}"`);
    
    // Log ALL files found (not just first 5) for debugging
    if (allFiles.length > 0) {
      console.log(`📋 All files found (${allFiles.length}):`, allFiles.map(f => ({
        name: f.name,
        isSvg: f.name.toLowerCase().endsWith('.svg'),
        size: f.metadata?.size || 'unknown'
      })));
    } else {
      console.log(`⚠️ fetchAllSvgs: No files found at all at prefix "${prefix}"`);
      // Try listing what's actually in the bucket to debug
      try {
        const [testFiles] = await bucket.getFiles({ prefix: '', maxResults: 50 });
        console.log(`📋 Root level files in bucket (first 50):`, testFiles.map(f => f.name));
      } catch (e) {
        console.error(`❌ Error listing root files:`, e);
      }
    }
    
    const svgFiles = allFiles.filter((f) => {
      const isSvg = f.name.toLowerCase().endsWith(".svg");
      if (!isSvg) {
        console.log(`⚠️ Skipping non-SVG file: ${f.name}`);
      }
      return isSvg;
    });
    console.log(`✅ fetchAllSvgs: Found ${svgFiles.length} SVG files at prefix "${prefix}"`);
    
    if (svgFiles.length > 0) {
      console.log(`📋 SVG files found:`, svgFiles.map(f => f.name));
    } else if (allFiles.length > 0) {
      console.warn(`⚠️ Found ${allFiles.length} files but none are SVG files!`);
    }
    
    return svgFiles;
  } catch (error: any) {
    console.error("❌ fetchAllSvgs: Error searching for files:", error);
    console.error("❌ fetchAllSvgs: Error details:", {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });
    console.log("📭 fetchAllSvgs: No files found at prefix:", prefix, "- returning empty array");
    return [];
  }
}

async function fetchUniqueSvg(bucket: Bucket, prefix: string): Promise<File> {
  const svgs = await fetchAllSvgs(bucket, prefix);
  if (svgs.length === 0) {
    const err: any = new Error(`No SVG found at ${prefix}`);
    err.code = "ENOENT";
    throw err;
  }
  if (svgs.length > 1) {
    const err: any = new Error(
      `Expected 1 SVG at ${prefix} but found ${svgs.length} (${svgs.map(f => f.name).join(", ")})`
    );
    err.code = "EXIST";
    throw err;
  }
  return svgs[0];
}

// --- single controller for both cases ---
export async function getFloorplan(req: Request, res: Response): Promise<void> {
  try { 
    const officeId = (req.params.officeId || "").trim();
    const floorId = (req.params.floorId || "").trim();
    console.log("route : /api/floorplans officeId",officeId)
    console.log("route : /api/floorplans floorId",floorId )

    console.log()

    if (!officeId) {
      res.status(400).json({ error: "officeId is required" });
      return;
    }

    const wantRaw = String(req.query.raw || "") === "1";              // only valid for single
    const wantSigned = String(req.query.signed ?? "true") !== "false";
    const expiresMin = clampInt(Number(req.query.expires || 60), 1, 4320);

    // ---- Case A: specific floor (unique SVG expected) ----
    if (floorId) {
      const prefix = ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/${floorId}/` : `${officeId}/${floorId}/`;
      const file = await fetchUniqueSvg(bucket, prefix);
      console.log("getFloorplan : file", file)

      if (wantRaw) {
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=60");
        file.createReadStream()
          .on("error", (err) => {
            console.error("Stream error:", err);
            if (!res.headersSent) res.status(500).end("Failed to read SVG");
          })
          .pipe(res);
        return;
      }

      let signedUrl: string | null = null;
      if (wantSigned) {
        try {
          const [url] = await file.getSignedUrl({
            version: "v4",
            action: "read",
            expires: Date.now() + expiresMin * 60 * 1000,
          });
          signedUrl = url;
        } catch (e: any) {
          console.warn("Signed URL generation failed:", e?.message || e);
        }
      }

      const [meta] = await file.getMetadata();
      res.json({
        ok: true,
        scope: "single",
        bucket: BUCKET,
        path: file.name,
        signedUrl,
        contentType: meta.contentType || "image/svg+xml",
        size: Number(meta.size || 0),
        updated: meta.updated,
        metadata: meta.metadata || {},
      });
      return;
    }

    // ---- Case B: list all floors under an office ----
    {
      const prefix = ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/` : `${officeId}/`;
      console.log("🔍 getFloorplan: Searching for files at prefix:", prefix);
      console.log("🔍 getFloorplan: Bucket:", bucket.name, "ROOT_PREFIX:", ROOT_PREFIX || '(empty - root level)');
      const files = await fetchAllSvgs(bucket, prefix);
      console.log("🔍 getFloorplan: Found files:", files.length, "files");
      if (files.length === 0) {
        console.log("📁 No SVG files found. Debugging folder structure...");
        try {
          // List all files at this prefix to see what's there
          const [allFilesAtPrefix] = await bucket.getFiles({ 
            prefix: prefix, 
            delimiter: '/',
            maxResults: 100 
          });
          console.log(`📁 Found ${allFilesAtPrefix.length} files/directories at prefix "${prefix}"`);
          
          // List subfolders (prefixes)
          const [subfolders] = await bucket.getFiles({ 
            prefix: prefix, 
            delimiter: '/',
            autoPaginate: true 
          });
          const [_, __, apiResponse] = subfolders as any;
          const prefixes = (apiResponse?.prefixes || []) as string[];
          console.log(`📁 Found ${prefixes.length} subfolders at prefix "${prefix}":`, prefixes);
          
          // List all files recursively (no delimiter) to see what's actually there
          const [allFilesRecursive] = await bucket.getFiles({ 
            prefix: prefix,
            maxResults: 100 
          });
          console.log(`📁 Found ${allFilesRecursive.length} total files recursively at prefix "${prefix}"`);
          if (allFilesRecursive.length > 0) {
            console.log(`📋 Sample files found recursively:`, allFilesRecursive.slice(0, 10).map(f => ({
              name: f.name,
              isSvg: f.name.toLowerCase().endsWith('.svg'),
              size: f.metadata.size
            })));
          }
          
          // Also list root level to debug
          const [rootFiles] = await bucket.getFiles({ prefix: '', maxResults: 20 });
          console.log(`📁 Root level files/folders (first 20):`, rootFiles.map(f => ({
            name: f.name,
            isSvg: f.name.toLowerCase().endsWith('.svg')
          })));
        } catch (e) {
          console.error("❌ Error listing bucket files:", e);
        }
      }
      if (!files.length) {
        // Return empty list for new offices instead of 404
        console.log("📭 No floorplans found for office:", officeId, "- returning empty list");
        res.json({
          ok: true,
          scope: "list",
          bucket: BUCKET,
          count: 0,
          items: [],
        });
        return;
      }

      // Optionally sign each (can be heavy for many; keep or toggle with ?signed=false)
      const items = await Promise.all(
        files.map(async (file) => {
          let signedUrl: string | null = null;
          if (wantSigned) {
            try {
              const [url] = await file.getSignedUrl({
                version: "v4",
                action: "read",
                expires: Date.now() + expiresMin * 60 * 1000,
              });
              signedUrl = url;
            } catch (e: any) {
              console.warn(`Signed URL failed for ${file.name}:`, e?.message || e);
            }
          }
          const [meta] = await file.getMetadata();
          return {
            path: file.name,
            signedUrl,
            contentType: meta.contentType || "image/svg+xml",
            size: Number(meta.size || 0),
            updated: meta.updated,
            metadata: meta.metadata || {},
          };
        })
      );

      res.json({
        ok: true,
        scope: "list",
        bucket: BUCKET,
        count: items.length,
        items,
      });
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      res.status(404).json({ error: err.message || "Not found" });
      return;
    }
    if (err?.code === "EXIST") {
      res.status(409).json({ error: err.message || "Multiple files found" });
      return;
    }
    console.error("getFloorplan error:", err?.message || err);
    res.status(500).json({ error: "Internal error" });
  }
}

export async function getAllFloorplans(req: Request, res: Response) {
  try {
    console.log("getAllFloorplans: Starting to fetch floorplans from bucket:", BUCKET);

    const officePrefixes = await listPrefixes(bucket, "");
    console.log("getAllFloorplans: Found office prefixes:", officePrefixes);

    const offices: any[] = [];

    for (const op of officePrefixes) {
      const officeId = op.replace(/\/$/, "");
      console.log("getAllFloorplans: Processing office:", officeId);

      // office-level file (direct under office/)
      const officeSvg = await tryBuildEntry(
        bucket,
        `${officeId}/`,
        officeId,
        null
      );

      // floors
      const floorPrefixes = await listPrefixes(bucket, `${officeId}/`);
      const floors = [];
      for (const fp of floorPrefixes) {
        const floorId = fp.replace(/^.+\/([^/]+)\/$/, "$1");
        const floorEntry = await tryBuildEntry(bucket, fp, officeId, floorId);
        if (floorEntry) floors.push(floorEntry);
      }

      offices.push({ officeId, ...(officeSvg ? { officeSvg } : {}), floors });
    }

    console.log("getAllFloorplans: Returning offices:", offices);
    res.json(offices);
  } catch (err: any) {
    console.error("getAllFloorplans error:", err?.message || err);
    console.error("getAllFloorplans stack:", err?.stack);
    res.status(500).json({
      error: "Internal error",
      message: err?.message || "Unknown error",
      bucket: BUCKET
    });
  }
}
//helper
async function listPrefixes(bucket: Bucket, prefix: string): Promise<string[]> {
  try {
    console.log("listPrefixes: Listing prefixes for bucket:", bucket.name, "prefix:", prefix);
    const opts: GetFilesOptions = { prefix, delimiter: "/", autoPaginate: true };
    const [_files, _next, apiResponse] = (await (bucket as any).getFiles(
      opts
    )) as [File[], any, { prefixes?: string[] }];
    const prefixes = (apiResponse?.prefixes || []).filter(Boolean);
    console.log("listPrefixes: Found prefixes:", prefixes);
    return prefixes;
  } catch (error) {
    console.error("listPrefixes error:", error);
    return [];
  }
}

async function tryBuildEntry(
  bucket: Bucket,
  prefix: string,
  officeId: string,
  floorId: string | null
) {
  const [files] = await bucket.getFiles({
    prefix,
    delimiter: "/",
    autoPaginate: false,
    maxResults: 50,
  });
  const svgs = files.filter((f) => f.name.toLowerCase().endsWith(".svg"));

  if (svgs.length === 0) return null;
  if (svgs.length > 1) {
    console.warn(
      `Multiple SVGs under ${prefix}: ${svgs.map((f) => f.name).join(", ")}`
    );
    return null;
  }

  const file = svgs[0];
  const [meta] = await file.getMetadata();

  return {
    officeId,
    floorId,
    path: file.name,
    size: Number(meta.size || 0),
    updated: meta.updated,
    metadata: meta.metadata || {},
  };
}
