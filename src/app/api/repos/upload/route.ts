import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { TMP_DIR } from "@/lib/db";
import { createRepoFromZip } from "@/lib/ingest";
import { ApiError } from "@/lib/errors";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ZIP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB guard

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected a multipart form upload.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "No zip file uploaded.");
    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new ApiError(400, "Only .zip archives are accepted.");
    }
    if (file.size === 0) throw new ApiError(400, "The uploaded archive is empty.");
    if (file.size > MAX_ZIP_BYTES) throw new ApiError(400, "Archive exceeds the 4 GB limit.");

    const tmpPath = path.join(
      TMP_DIR,
      `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`,
    );
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tmpPath, buf);

    const id = createRepoFromZip(tmpPath, file.name);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
