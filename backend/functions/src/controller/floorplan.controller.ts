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


const storage: Storage = initializeStorage();
const bucket = storage.bucket(BUCKET);

/** Main upload handler for Firebase Functions */
export async function handleUpload(req: Request, res: Response): Promise<void> {

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

    const { fields, file } = await parseMultipartFromRawBody(
      rawBody,
      req.headers["content-type"] as string
    );

    await processUpload(fields, file, res, cleanup);
  } catch (error: any) {
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

  if (!officeId) {
    res.status(400).json({ error: "officeId is required" });
    return;
  }

  if (!floorId) {
    res.status(400).json({ error: "floorId is required" });
    return;
  }

  const tempId = randomUUID();
  const tmp = path.join(os.tmpdir(), `upload-${tempId}.svg`);
  await fs.writeFile(tmp, file.buffer);

  try {
    // Build final destination key
    const sanitizedName = (sanitizeBaseName(fileName) || "floorplan") + ".svg";
    const prefix = ROOT_PREFIX ? `${ROOT_PREFIX}/` : '';
    const finalKey = `${prefix}${officeId}/${floorId}/${sanitizedName}`;


    // Only check exact target file; folders are virtual and auto-created
    const targetFile = bucket.file(finalKey);
    const [exists] = await targetFile.exists();
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
      await fs.unlink(tmp).catch(() => { });
      res.status(201).json({
        ok: true,
        bucket: BUCKET,
        path: finalKey,
        signedUrl: null,
        // signedUrlError: "Failed to generate signed URL",
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
    
    const opts: GetFilesOptions = {
      prefix,            // recursive search (no delimiter)
      autoPaginate: true
    };
    
    const [allFiles] = await bucket.getFiles(opts);
    
    const svgFiles = allFiles.filter((f) => f.name.toLowerCase().endsWith(".svg"));
    return svgFiles;
  } catch (error: any) {
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

      if (wantRaw) {
        // Stream SVG directly with aggressive caching for better performance
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=3600, immutable"); // Cache for 1 hour
        res.setHeader("Access-Control-Allow-Origin", "*"); // Allow CORS
        file.createReadStream()
          .on("error", (err) => {

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
          // Ignore signing errors
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
      const files = await fetchAllSvgs(bucket, prefix);
      if (!files.length) {
        // Return empty list for new offices instead of 404
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
              // Ignore signing errors
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

    res.status(500).json({ error: "Internal error" });
  }
}

export async function getAllFloorplans(req: Request, res: Response) {
  try {

    const officePrefixes = await listPrefixes(bucket, "");

    const offices: any[] = [];

    for (const op of officePrefixes) {
      const officeId = op.replace(/\/$/, "");

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

    res.json(offices);
  } catch (err: any) {
    res.status(500).json({
      error: "Internal error",
      message: err?.message || "Unknown error",
      bucket: BUCKET
    });
  }
}

/** DELETE /api/floorplans/:officeId[/:floorId][/:filename] - Delete floorplan with audit logging */
export async function deleteFloorplan(req: Request, res: Response): Promise<void> {
  try {
    const officeId = (req.params.officeId || "").trim();
    const floorId = (req.params.floorId || "").trim(); // Optional
    // Decode the filename in case it's URL-encoded
    let filename = (req.params.filename || "").trim();
    if (filename) {
      filename = decodeURIComponent(filename);
    }

    console.log('[deleteFloorplan] Received params:', {
      officeId,
      floorId,
      filename,
      rawFilename: req.params.filename
    });

    if (!officeId) {
      res.status(400).json({ error: "officeId is required" });
      return;
    }

    // Case 1: Delete specific file
    if (filename) {
      const filePath = floorId
        ? (ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/${floorId}/${filename}` : `${officeId}/${floorId}/${filename}`)
        : (ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/${filename}` : `${officeId}/${filename}`);

      console.log('[deleteFloorplan] Attempting to delete file:', {
        officeId,
        floorId,
        filename,
        filePath,
        ROOT_PREFIX
      });

      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      console.log('[deleteFloorplan] File exists:', exists);

      if (!exists) {
        // Try to list files in the directory to help debug
        const prefix = floorId
          ? (ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/${floorId}/` : `${officeId}/${floorId}/`)
          : (ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/` : `${officeId}/`);

        console.log('[deleteFloorplan] Listing files in prefix:', prefix);
        const existingFiles = await fetchAllSvgs(bucket, prefix);
        console.log('[deleteFloorplan] Existing files:', existingFiles.map(f => f.name));

        res.status(404).json({
          error: "File not found",
          officeId,
          floorId: floorId || "office-level",
          filename,
          path: filePath,
          message: `File not found at ${filePath}`,
          existingFiles: existingFiles.map(f => f.name),
          debug: {
            searchedPath: filePath,
            prefix,
            ROOT_PREFIX
          }
        });
        return;
      }

      // Get user info for audit log
      const userId = (req as any).user?.uid || (req as any).user?.id || "unknown";
      const userEmail = (req as any).user?.email || "unknown";

      // Get metadata before deletion
      const [metadata] = await file.getMetadata();
      const auditData = {
        path: file.name,
        size: Number(metadata.size || 0),
        contentType: metadata.contentType || "image/svg+xml",
        updated: metadata.updated,
        metadata: metadata.metadata || {},
      };

      // Delete the specific file
      await file.delete();

      // Log audit event
      try {
        await logDeletionAudit({
          officeId,
          floorId,
          deletedFiles: [auditData],
          deletedBy: userId,
          deletedByEmail: userEmail,
          timestamp: new Date().toISOString(),
        });
      } catch (auditErr: any) {
        // Continue even if audit logging fails
      }

      res.status(200).json({
        success: true,
        message: `Successfully deleted floorplan file: ${filename}`,
        deletedFiles: [auditData.path],
        officeId,
        floorId,
        filename,
      });
      return;
    }

    // Case 2: Delete all files at location (original behavior)
    // Build prefix based on whether floorId is provided
    // Floor-level: {officeId}/{floorId}/
    // Office-level: {officeId}/
    const prefix = floorId
      ? (ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/${floorId}/` : `${officeId}/${floorId}/`)
      : (ROOT_PREFIX ? `${ROOT_PREFIX}/${officeId}/` : `${officeId}/`);


    // Find all SVG files at this location
    const files = await fetchAllSvgs(bucket, prefix);

    if (files.length === 0) {
      res.status(404).json({
        error: "Floorplan not found",
        officeId,
        floorId: floorId || "office-level",
        prefix,
        message: `No floorplan files found at ${prefix}`
      });
      return;
    }

    // Get user info for audit log (from auth middleware if available)
    const userId = (req as any).user?.uid || (req as any).user?.id || "unknown";
    const userEmail = (req as any).user?.email || "unknown";


    // Delete all SVG files at this location
    const deletePromises = files.map(async (file) => {
      const [metadata] = await file.getMetadata();

      // Store metadata for audit log before deletion
      const auditData = {
        path: file.name,
        size: Number(metadata.size || 0),
        contentType: metadata.contentType || "image/svg+xml",
        updated: metadata.updated,
        metadata: metadata.metadata || {},
      };

      // Delete the file
      await file.delete();

      return auditData;
    });

    const deletedFiles = await Promise.all(deletePromises);

    // Log audit event to Firestore
    try {
      await logDeletionAudit({
        officeId,
        floorId,
        deletedFiles,
        deletedBy: userId,
        deletedByEmail: userEmail,
        timestamp: new Date().toISOString(),
      });
    } catch (auditErr: any) {
      // Continue even if audit logging fails
    }


    res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedFiles.length} floorplan file(s)`,
      deletedFiles: deletedFiles.map(f => f.path),
      officeId,
      floorId,
    });
  } catch (err: any) {
    // Check if it's a permission error
    if (err?.code === 403 || err?.message?.includes("permission")) {
      res.status(403).json({
        error: "Permission denied",
        message: "You do not have permission to delete this floorplan"
      });
      return;
    }

    res.status(500).json({
      error: "Failed to delete floorplan",
      message: err?.message || "Internal error",
    });
  }
}

/** Helper: Log deletion to Firestore audit collection */
async function logDeletionAudit(data: {
  officeId: string;
  floorId: string;
  deletedFiles: any[];
  deletedBy: string;
  deletedByEmail: string;
  timestamp: string;
}): Promise<void> {
  try {
    const admin = await import("firebase-admin");
    const db = admin.firestore();

    await db.collection("floorplan_audit_log").add({
      action: "delete",
      ...data,
    });

  } catch (err: any) {
    throw err;
  }
}
//helper
async function listPrefixes(bucket: Bucket, prefix: string): Promise<string[]> {
  try {
    const opts: GetFilesOptions = { prefix, delimiter: "/", autoPaginate: true };
    const [_files, _next, apiResponse] = (await (bucket as any).getFiles(
      opts
    )) as [File[], any, { prefixes?: string[] }];
    const prefixes = (apiResponse?.prefixes || []).filter(Boolean);
    return prefixes;
  } catch (error) {
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
