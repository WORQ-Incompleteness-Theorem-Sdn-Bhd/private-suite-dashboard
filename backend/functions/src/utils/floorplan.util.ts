// utils/floorplan.utils.ts
import { Request } from "express";
import { Storage, Bucket, File, GetFilesOptions } from "@google-cloud/storage"; // Import the Google Cloud Storage module
import busboy from "busboy"; // Import the busboy module (multipart/form-data parsing)

/** Prefer ADC, fall back to explicit credentials from env */
export function initializeStorage(): Storage { // initialize the storage
  try {
    return new Storage();
  } catch {
    console.warn(
      "Failed to use default credentials, trying explicit credentials"
    ); // log the error

    const email = process.env.F1REBASE_CLIENT_EMAIL; // email from environment variables
    const key = process.env.F1REBASE_PRIVATE_KEY; // key from environment variables
    const projectId = process.env.F1REBASE_PROJECT_ID; // project id from environment variables

    if (email && key) { // if the email and key are present
      return new Storage({ // create a new storage instance
        projectId, // project id
        credentials: { // credentials (client email and private key)
          client_email: email,
          private_key: key.replace(/\\n/g, "\n"), // replace the new line characters with a new line
        },
      });
    }

    throw new Error("No Google Cloud credentials found"); // throw an error if the email and key are not present
  }
}

export function sanitizeBaseName(s: string) { // sanitize the base name (replace all non-alphanumeric characters with an underscore)
  return s.replace(/[^a-z0-9-_]/gi, "_");
}

/** Parse multipart from rawBody (Firebase Functions) */
export function parseMultipartFromRawBody( // parse the multipart from the raw body
  rawBody: Buffer,
  contentType: string 
): Promise<{ 
  fields: Record<string, string>; // fields from the multipart
  file: { buffer: Buffer; filename: string; size: number } | null; // file from the multipart
}> {
  return new Promise((resolve, reject) => { 
    const fields: Record<string, string> = {}; 
    let file: { buffer: Buffer; filename: string; size: number } | null = null;  

    const bb = busboy({  
      headers: { "content-type": contentType },
      limits: { fileSize: 10 * 1024 * 1024 }, //content-type to tell Busboy how to parse the data) and setting limits, such as a maximum file size (10MB)
    });

    bb.on("field", (name, value) => { // field event = triggers whenever Busboy sees a text field in the form.
      fields[name] = value;
      console.log(`🧾 Field: ${name} = ${value}`); //It stores the value in a fields object.
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
export function parseMultipartFromStream(req: Request): Promise<{ // parse the multipart from the streaming express request
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
