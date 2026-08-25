import { describe, expect, it, mock } from "bun:test";
import {
  generateQuizFromGemini,
  QUIZ_MODEL,
  QUIZ_THINKING_LEVEL,
} from "../src/api/v1/quiz.route";

describe("Gemini quiz generation", () => {
  it("uses PDF input, structured JSON, and high thinking", async () => {
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
    const generateContent = mock(async (_request: any) => ({
      text: JSON.stringify(quiz),
    }));

    const result = await generateQuizFromGemini(
      [{ data: "pdf-data", mimeType: "application/pdf" }],
      "Skapa ett quiz för TATA41",
      { models: { generateContent } } as any,
    );

    expect(result).toEqual(quiz);
    const request = generateContent.mock.calls[0]![0] as any;
    expect(request).toMatchObject({
      model: QUIZ_MODEL,
      config: {
        thinkingConfig: { thinkingLevel: QUIZ_THINKING_LEVEL.toUpperCase() },
        responseMimeType: "application/json",
        maxOutputTokens: 8000,
      },
    });
    expect(request.config.responseJsonSchema).toBeDefined();
    expect(request.contents[0].parts).toEqual([
      { text: "Tentamensunderlag 1:" },
      {
        inlineData: {
          mimeType: "application/pdf",
          data: "pdf-data",
        },
      },
      { text: expect.stringContaining("Skapa ett quiz för TATA41") },
    ]);
  });

  it("rejects empty or invalid model output", async () => {
    const empty = { models: { generateContent: async () => ({ text: "" }) } };
    await expect(
      generateQuizFromGemini([], "Prompt", empty as any),
    ).rejects.toThrow("Gemini returned empty response");

    const invalid = {
      models: { generateContent: async () => ({ text: '{"quiz":{}}' }) },
    };
    await expect(
      generateQuizFromGemini([], "Prompt", invalid as any),
    ).rejects.toThrow();
  });
});
