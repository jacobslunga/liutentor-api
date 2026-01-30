import { SupabaseClient } from "@supabase/supabase-js";
import { Hono, Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Exam, ExamReturn } from "../../types/exams";

const exams = new Hono().basePath("/exams");

function _getExams(
  courseCode: string,
  uni: string,
  supabase: SupabaseClient,
): ExamReturn {
  return {
    courseCode: "",
    courseName: "",
    exams: [],
  };
}

export async function getExams(c: Context) {
  const supabase = c.get("supabase");
  const { courseCode } = c.req.param();

  if (!courseCode) {
    throw new HTTPException(400, {
      message: "Missing required parameter: courseCode",
    });
  }
}
