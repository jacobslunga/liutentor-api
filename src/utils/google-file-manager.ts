import { GoogleAIFileManager } from "@google/generative-ai/server";
import { supabase } from "~/db/supabase";
import { unlinkSync } from "node:fs";

const fileManager = new GoogleAIFileManager(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
);

export async function getCachedFileUri(
  type: "exam" | "solution",
  identifierId: string,
  pdfUrl: string,
): Promise<string> {
  let tableName = type === "exam" ? "exams" : "solutions";

  let query = supabase
    .from(tableName)
    .select("id, google_file_uri, google_file_expires_at, pdf_url");

  if (type === "exam") {
    query = query.eq("id", identifierId);
  } else {
    // Note: Assuming 'solutions' table has 'exam_id' column based on user code
    query = query.eq("exam_id", identifierId).eq("pdf_url", pdfUrl);
  }

  const { data: rows, error: fetchError } = await query;

  if (fetchError) {
    console.error(`[CACHE:${type}] DB Read Error`, fetchError);
    return pdfUrl;
  }

  if (!rows || rows.length === 0) {
    return pdfUrl;
  }

  const record = rows[0];
  const now = new Date();
  
  if (record.google_file_uri && record.google_file_expires_at) {
    const expiresAt = new Date(record.google_file_expires_at);
    const validUntil = new Date(now.getTime() + 5 * 60000);

    if (expiresAt > validUntil) {
      return record.google_file_uri;
    }
  }

  try {
    const response = await fetch(pdfUrl);
    if (!response.ok)
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);

    const tempPath = `/tmp/${type}-${record.id}-${Date.now()}.pdf`;
    const arrayBuffer = await response.arrayBuffer();

    await Bun.write(tempPath, arrayBuffer);

    const uploadResult = await fileManager.uploadFile(tempPath, {
      mimeType: "application/pdf",
      displayName: `${type.toUpperCase()} - ${identifierId}`,
    });

    try {
      unlinkSync(tempPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    const { error: updateError } = await supabase
      .from(tableName)
      .update({
        google_file_uri: uploadResult.file.uri,
        google_file_expires_at: uploadResult.file.expirationTime,
      })
      .eq("id", record.id);

    if (updateError) {
      console.error(`[CACHE:${type}] DB Write Failed`, updateError);
    }

    return uploadResult.file.uri;
  } catch (err) {
    console.error(`[CACHE:${type}] Upload Error:`, err);
    return pdfUrl;
  }
}
