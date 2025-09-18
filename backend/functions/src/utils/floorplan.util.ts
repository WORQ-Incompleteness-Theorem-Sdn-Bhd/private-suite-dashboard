// utils/floorplan.utils.ts
import { Request } from "express";
import { Storage, Bucket, File, GetFilesOptions } from "@google-cloud/storage";
import busboy from "busboy";

/** Prefer ADC, fall back to explicit credentials from env */
export function initializeStorage(): Storage {
  try {
    return new Storage();
  } catch {
    console.warn(
      "Failed to use default credentials, trying explicit credentials"
    );

    const email = process.env.F1REBASE_CLIENT_EMAIL ?? 'firebase-adminsdk-fbsvc@floorplan-dashboard-2a468.iam.gserviceaccount.com';
    const key = process.env.F1REBASE_PRIVATE_KEY;
    const projectId = process.env.F1REBASE_PROJECT_ID;

    if (email && key) {
      return new Storage({
        projectId,
        credentials: {
          client_email: email,
          private_key: key.replace(/\\n/g, "\n"),
        },
      });
    }

    throw new Error("No Google Cloud credentials found");
  }
}

export function sanitizeBaseName(s: string) {
  return s.replace(/[^a-z0-9-_]/gi, "_");
}

/** Parse multipart from rawBody (Firebase Functions) */
export function parseMultipartFromRawBody(
  rawBody: Buffer,
  contentType: string
): Promise<{
  fields: Record<string, string>;
  file: { buffer: Buffer; filename: string; size: number } | null;
}> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; filename: string; size: number } | null = null;

    const bb = busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: 10 * 1024 * 1024 },
    });

    bb.on("field", (name, value) => {
      fields[name] = value;
      console.log(`🧾 Field: ${name} = ${value}`);
    });

    bb.on("file", (_name, stream, info) => {
      const chunks: Buffer[] = [];
      let size = 0;

      stream.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      stream.on("end", () => {
        file = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          size,
        };
        console.log(`✅ File received: ${info.filename}, size: ${size} bytes`);
      });

      stream.on("error", reject);
    });

    bb.on("close", () => resolve({ fields, file }));
    bb.on("error", reject);

    bb.write(rawBody);
    bb.end();
  });
}

/** Parse multipart from a streaming Express request */
export function parseMultipartFromStream(req: Request): Promise<{
  fields: Record<string, string>;
  file: { buffer: Buffer; filename: string; size: number } | null;
}> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; filename: string; size: number } | null = null;

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024 },
    });

    bb.on("field", (name, value) => {
      fields[name] = value;
      console.log(`🧾 Field: ${name} = ${value}`);
    });

    bb.on("file", (_name, stream, info) => {
      const chunks: Buffer[] = [];
      let size = 0;

      stream.on("data", (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      stream.on("end", () => {
        file = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          size,
        };
        console.log(`✅ File received: ${info.filename}, size: ${size} bytes`);
      });

      stream.on("error", reject);
    });

    bb.on("close", () => resolve({ fields, file }));
    bb.on("error", reject);

    req.pipe(bb);
  });
}

/** List exactly one SVG under the prefix (direct children only). */
export async function fetchUniqueSvg(
  bucket: Bucket,
  prefix: string
): Promise<File> {
  const opts: GetFilesOptions = {
    prefix,
    delimiter: "/",
    autoPaginate: false,
    maxResults: 50,
  };

  const [files] = await bucket.getFiles(opts);
  const svgs = files.filter((f) => f.name.toLowerCase().endsWith(".svg"));
  console.log("fetchUniqueSvg : svgs",svgs)

  if (svgs.length === 0) {
    const err: any = new Error(`No SVG found at ${prefix}`);
    err.code = "ENOENT";
    throw err;
  }
  if (svgs.length > 1) {
    const err: any = new Error(
      `Expected 1 SVG at ${prefix} but found ${svgs.length} (${svgs
        .map((f) => f.name)
        .join(", ")})`
    );
    err.code = "EEXIST";
    throw err;
  }
  return svgs[0];
}

export function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
