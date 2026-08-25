import { z } from 'zod';

export const courseCodeSchema = z.object({
  courseCode: z.string().trim().min(2).max(32),
});

export const multipleChoiceQuestionSchema = z.object({
  id: z.number().int().positive(),
  question: z.string().min(4),
  options: z.array(z.string().min(1)).length(4),
  answer: z.number().int().min(0).max(3),
});

/**
 * How demanding the generated questions should be. Only the cognitive level
 * changes across tiers — the option-parity rules in the prompt (equal length,
 * parallel form, plausible distractors) hold at every difficulty, since those
 * exist to stop guessing on surface cues rather than to make the quiz hard.
 */
export const quizDifficultySchema = z.enum(["easy", "medium", "hard"]);

export type QuizDifficulty = z.infer<typeof quizDifficultySchema>;

export const DEFAULT_QUIZ_DIFFICULTY: QuizDifficulty = "medium";

export const multipleChoiceQuizSchema = z.object({
  quiz: z.object({
    questions: z.array(multipleChoiceQuestionSchema).min(10).max(20),
  }),
});

export type MultipleChoiceQuiz = z.infer<typeof multipleChoiceQuizSchema>;
