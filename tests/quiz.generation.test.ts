import { describe, expect, it, mock } from "bun:test";
import {
  generateQuizFromOpenAI,
  QUIZ_MODEL,
  QUIZ_REASONING_EFFORT,
} from "../src/api/v1/quiz.route";

describe("OpenAI quiz generation", () => {
  it("uses PDF input, structured JSON, and high effort", async () => {
    const quiz = {
      quiz: {
        questions: Array.from({ length: 10 }, (_, index) => ({
          id: index + 1,
          question: `Vilket svar är korrekt för fråga ${index + 1}?`,
          options: ["A", "B", "C", "D"],
          answer: index % 4,
        })),
      },
    };
    const create = mock(async (_request: any) => ({
      output_text: JSON.stringify(quiz),
    }));

    const result = await generateQuizFromOpenAI(
      [{ data: "pdf-data", mimeType: "application/pdf" }],
      "Skapa ett quiz för TATA41",
      { responses: { create } } as any,
    );

    expect(result).toEqual(quiz);
    const request = create.mock.calls[0]![0] as any;
    expect(request).toMatchObject({
      model: QUIZ_MODEL,
      reasoning: { effort: QUIZ_REASONING_EFFORT },
      max_output_tokens: 8000,
      store: false,
    });
    expect(request.text.format).toMatchObject({
      type: "json_schema",
      name: "multiple_choice_quiz",
      strict: true,
    });
    expect(request.text.format.schema).toBeDefined();
    expect(request.input[0].content).toEqual([
      { type: "input_text", text: "Tentamensunderlag 1:" },
      {
        type: "input_file",
        filename: "tenta-1.pdf",
        file_data: "data:application/pdf;base64,pdf-data",
      },
      {
        type: "input_text",
        text: expect.stringContaining("Skapa ett quiz för TATA41"),
      },
    ]);
  });

  it("rejects empty or invalid model output", async () => {
    const empty = { responses: { create: async () => ({ output_text: "" }) } };
    await expect(
      generateQuizFromOpenAI([], "Prompt", empty as any),
    ).rejects.toThrow("OpenAI returned empty response");

    const invalid = {
      responses: { create: async () => ({ output_text: '{"quiz":{}}' }) },
    };
    await expect(
      generateQuizFromOpenAI([], "Prompt", invalid as any),
    ).rejects.toThrow();
  });
});
