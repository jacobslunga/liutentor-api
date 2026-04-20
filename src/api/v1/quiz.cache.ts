import { supabase } from "~/db/supabase";
import type { MultipleChoiceQuiz } from "./quiz.schemas";

/**
 * Logs a generated quiz to the database for history and scorekeeping.
 * This version skips duplication checks to ensure every unique user session is recorded.
 */
export async function logQuizGeneration(payload: {
  user_id: string | null;
  anonymous_user_id: string;
  course_code: string;
  quiz_type: string;
  quiz: MultipleChoiceQuiz;
  source_exam_ids: number[];
  source_count: number;
  model: string;
}): Promise<void> {
  supabase
    .from("ai_quiz_logs")
    .insert({
      user_id: payload.user_id,
      anonymous_user_id: payload.anonymous_user_id,
      course_code: payload.course_code,
      quiz_type: payload.quiz_type,
      quiz: payload.quiz,
      source_exam_ids: payload.source_exam_ids,
      source_count: payload.source_count,
      model: payload.model,
    })
    .then(({ error }) => {
      if (error) {
        console.error("Critical: Failed to log quiz to DB:", error.message);
      }
    });
}

/**
 * Fetches a random recent quiz from the global pool to save on LLM costs
 * by offering pre-generated content where appropriate.
 */
export async function getRandomCachedQuiz(courseCode: string): Promise<
  | (MultipleChoiceQuiz & {
      meta: {
        courseCode: string;
        sourceExamIds: number[];
        sourceCount: number;
      };
    })
  | null
> {
  const { data, error } = await supabase
    .from("ai_quiz_logs")
    .select("quiz, source_exam_ids, source_count")
    .eq("course_code", courseCode)
    .eq("quiz_type", "multiple_choice")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data || data.length === 0) return null;

  const row = data[Math.floor(Math.random() * data.length)];

  return {
    ...row.quiz,
    meta: {
      courseCode,
      sourceExamIds: row.source_exam_ids,
      sourceCount: row.source_count,
    },
  };
}
