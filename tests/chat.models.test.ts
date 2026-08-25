import { describe, expect, it, mock } from "bun:test";
import {
  CHAT_TIER_IDS,
  DEFAULT_MODEL_ID,
  GEMINI_CHAT_MODEL_ID,
  getModelConfig,
  getModelLogId,
} from "../src/api/v1/chat.models";
import {
  buildGeminiAttachmentParts,
  streamGeminiResponse,
  type PdfData,
} from "../src/utils/chat.utils";

describe("chat model routing", () => {
  it("maps every tier to Gemini with increasing thinking", () => {
    expect(getModelConfig(CHAT_TIER_IDS.low)).toMatchObject({
      provider: "google",
      modelId: GEMINI_CHAT_MODEL_ID,
      thinkingLevel: "minimal",
    });
    expect(getModelConfig(CHAT_TIER_IDS.balanced)).toMatchObject({
      provider: "google",
      modelId: GEMINI_CHAT_MODEL_ID,
      thinkingLevel: "medium",
    });
    expect(getModelConfig(CHAT_TIER_IDS.deep)).toMatchObject({
      provider: "google",
      modelId: GEMINI_CHAT_MODEL_ID,
      thinkingLevel: "high",
      requiresAuth: true,
    });
  });

  it("falls back to the low tier for omitted, empty, or unknown IDs", () => {
    expect(DEFAULT_MODEL_ID).toBe(CHAT_TIER_IDS.low);
    for (const id of [undefined, "", "unknown-model"]) {
      expect(getModelConfig(id)).toMatchObject({
        provider: "google",
        modelId: GEMINI_CHAT_MODEL_ID,
        thinkingLevel: "minimal",
      });
    }
  });

  it("keeps old clients compatible while preserving deep-tier auth", () => {
    expect(getModelConfig("gemini-3.1-flash-lite").thinkingLevel).toBe(
      "minimal",
    );
    expect(getModelConfig("gpt-5.6-luna").thinkingLevel).toBe("medium");
    expect(getModelConfig("gpt-5.6-terra")).toMatchObject({
      thinkingLevel: "high",
      requiresAuth: true,
    });
  });

  it("marks every tier as searchable and includes effort in logs", () => {
    for (const id of Object.values(CHAT_TIER_IDS)) {
      const config = getModelConfig(id);
      expect(config.supportsWebSearch).toBe(true);
      expect(getModelLogId(config)).toBe(
        `${GEMINI_CHAT_MODEL_ID}:${config.thinkingLevel}`,
      );
    }
  });
});

describe("Gemini chat streaming", () => {
  const pdfs: PdfData[] = [
    { data: "exam-data", mimeType: "application/pdf", label: "tenta" },
    { data: "solution-data", mimeType: "application/pdf", label: "facit" },
  ];

  const userAttachments = [
    {
      data: "user-pdf",
      filename: "anteckningar.pdf",
      mediaType: "application/pdf" as const,
    },
    {
      data: "user-image",
      filename: "figur.png",
      mediaType: "image/png" as const,
    },
  ];

  it("builds native Gemini attachment parts", () => {
    expect(buildGeminiAttachmentParts(userAttachments)).toEqual([
      expect.objectContaining({ text: expect.any(String) }),
      { inlineData: { mimeType: "application/pdf", data: "user-pdf" } },
      expect.objectContaining({ text: expect.any(String) }),
      { inlineData: { mimeType: "image/png", data: "user-image" } },
    ]);
  });

  it("passes the selected thinking level and multimodal context", async () => {
    const generateContentStream = mock(async (_request: any) =>
      (async function* () {
        yield { text: "Hej" };
        yield { text: " världen" };
      })(),
    );

    const chunks: string[] = [];
    for await (const event of streamGeminiResponse(
      "Systemprompt",
      [
        { role: "user", content: "Tidigare fråga" },
        { role: "assistant", content: "Tidigare svar" },
        { role: "user", content: "Ny fråga" },
      ],
      GEMINI_CHAT_MODEL_ID,
      pdfs,
      userAttachments,
      "Ny fråga",
      "markerad text",
      undefined,
      false,
      "medium",
      { models: { generateContentStream } } as any,
    )) {
      if (event.type === "text") chunks.push(event.delta);
    }

    expect(chunks).toEqual(["Hej", " världen"]);
    const request = generateContentStream.mock.calls[0]![0] as any;
    expect(request).toMatchObject({
      model: GEMINI_CHAT_MODEL_ID,
      config: {
        systemInstruction: "Systemprompt",
        thinkingConfig: { thinkingLevel: "MEDIUM" },
      },
    });
    expect(request.contents[0].parts).toEqual([
      expect.objectContaining({ text: expect.any(String) }),
      { inlineData: { mimeType: "application/pdf", data: "exam-data" } },
      expect.objectContaining({ text: expect.any(String) }),
      { inlineData: { mimeType: "application/pdf", data: "solution-data" } },
    ]);
    expect(request.contents.at(-1).parts).toEqual([
      expect.objectContaining({ text: expect.stringContaining("anteckningar.pdf") }),
      { inlineData: { mimeType: "application/pdf", data: "user-pdf" } },
      expect.objectContaining({ text: expect.stringContaining("figur.png") }),
      { inlineData: { mimeType: "image/png", data: "user-image" } },
      { text: expect.stringContaining("markerad text") },
    ]);
  });

  it("adds search only when requested and emits status and sources", async () => {
    const calls: any[] = [];
    const generateContentStream = async (request: any) => {
      calls.push(request);
      return (async function* () {
        yield {
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      uri: "https://liu.se/tenta",
                      title: "Tentaperioder",
                    },
                  },
                ],
              },
            },
          ],
        };
        yield { text: "Svar" };
      })();
    };

    for (const webSearch of [false, true]) {
      const events: any[] = [];
      for await (const event of streamGeminiResponse(
        "Systemprompt",
        [{ role: "user", content: "Fråga" }],
        GEMINI_CHAT_MODEL_ID,
        [],
        [],
        "Fråga",
        undefined,
        undefined,
        webSearch,
        "high",
        { models: { generateContentStream } } as any,
      )) {
        events.push(event);
      }

      if (webSearch) {
        expect(events).toEqual([
          { type: "status", step: "searching", message: "Söker på webben" },
          { type: "status", step: "search_done", message: "Läser källor" },
          { type: "text", delta: "Svar" },
          {
            type: "sources",
            items: [{ title: "Tentaperioder", url: "https://liu.se/tenta" }],
          },
        ]);
      }
    }

    expect(calls[0].config).not.toHaveProperty("tools");
    expect(calls[1].config.tools).toEqual([{ googleSearch: {} }]);
  });
});
