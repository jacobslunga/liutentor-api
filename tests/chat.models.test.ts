import { describe, expect, it, mock } from "bun:test";
import {
  CHAT_TIER_IDS,
  DEFAULT_MODEL_ID,
  LUNA_CHAT_MODEL_ID,
  TERRA_CHAT_MODEL_ID,
  getModelConfig,
  getModelLogId,
} from "../src/api/v1/chat.models";
import {
  buildOpenAIInput,
  streamOpenAIResponse,
  type PdfData,
} from "../src/utils/chat.utils";

describe("chat model routing", () => {
  it("maps every tier to an OpenAI model with increasing effort", () => {
    expect(getModelConfig(CHAT_TIER_IDS.low)).toMatchObject({
      provider: "openai",
      modelId: LUNA_CHAT_MODEL_ID,
      effort: "low",
    });
    expect(getModelConfig(CHAT_TIER_IDS.balanced)).toMatchObject({
      provider: "openai",
      modelId: LUNA_CHAT_MODEL_ID,
      effort: "medium",
    });
    expect(getModelConfig(CHAT_TIER_IDS.deep)).toMatchObject({
      provider: "openai",
      modelId: TERRA_CHAT_MODEL_ID,
      effort: "high",
      requiresAuth: true,
    });
  });

  it("falls back to the low tier for omitted, empty, or unknown IDs", () => {
    expect(DEFAULT_MODEL_ID).toBe(CHAT_TIER_IDS.low);
    for (const id of [undefined, "", "unknown-model"]) {
      expect(getModelConfig(id)).toMatchObject({
        provider: "openai",
        modelId: LUNA_CHAT_MODEL_ID,
        effort: "low",
      });
    }
  });

  it("keeps old clients compatible while preserving deep-tier auth", () => {
    expect(getModelConfig("gemini-flash-lite-minimal").effort).toBe("low");
    expect(getModelConfig("gemini-flash-lite-medium").effort).toBe("medium");
    expect(getModelConfig("gemini-flash-lite-high")).toMatchObject({
      modelId: TERRA_CHAT_MODEL_ID,
      effort: "high",
      requiresAuth: true,
    });
    expect(getModelConfig("gemini-3.1-flash-lite").effort).toBe("low");
    expect(getModelConfig("gpt-5.6-luna").effort).toBe("medium");
    expect(getModelConfig("gpt-5.6-terra")).toMatchObject({
      effort: "high",
      requiresAuth: true,
    });
  });

  it("marks every tier as searchable and includes effort in logs", () => {
    for (const id of Object.values(CHAT_TIER_IDS)) {
      const config = getModelConfig(id);
      expect(config.supportsWebSearch).toBe(true);
      expect(getModelLogId(config)).toBe(
        `${config.modelId}:${config.effort}`,
      );
    }
  });
});

// Shaped like production: two full Supabase storage URLs, well past 64 chars.
const LONG_CACHE_KEY =
  "https://abcdefghijklmnop.supabase.co/storage/v1/object/public/exams/TATA41/TEN1-2020-06-03.pdf:" +
  "https://abcdefghijklmnop.supabase.co/storage/v1/object/public/exams/TATA41/TEN1-2020-06-03-solutions.pdf";

describe("OpenAI chat streaming", () => {
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

  it("builds native attachment blocks for user files", () => {
    const input = buildOpenAIInput(
      [{ role: "user", content: "Fråga" }],
      [],
      userAttachments,
      "Fråga",
    );
    expect((input[0] as any).content).toEqual([
      expect.objectContaining({
        type: "input_text",
        text: expect.stringContaining("anteckningar.pdf"),
      }),
      expect.objectContaining({ type: "input_file" }),
      expect.objectContaining({
        type: "input_text",
        text: expect.stringContaining("figur.png"),
      }),
      expect.objectContaining({ type: "input_image" }),
      { type: "input_text", text: "Användarens fråga: Fråga" },
    ]);
  });

  it("builds input with PDFs, history, and selection context", () => {
    const input = buildOpenAIInput(
      [
        { role: "user", content: "Tidigare fråga" },
        { role: "assistant", content: "Tidigare svar" },
        { role: "user", content: "Ny fråga" },
      ],
      pdfs,
      [],
      "Ny fråga",
      "markerad text",
    );

    expect(input[0]).toMatchObject({ role: "user" });
    expect((input[0] as any).content).toEqual([
      expect.objectContaining({ type: "input_text" }),
      {
        type: "input_file",
        filename: "tenta.pdf",
        file_data: "data:application/pdf;base64,exam-data",
        detail: "auto",
      },
      expect.objectContaining({ type: "input_text" }),
      {
        type: "input_file",
        filename: "facit.pdf",
        file_data: "data:application/pdf;base64,solution-data",
        detail: "auto",
      },
    ]);
    expect(input.slice(1)).toEqual([
      { role: "assistant", content: "Jag har läst igenom de bifogade filerna." },
      { role: "user", content: "Tidigare fråga" },
      { role: "assistant", content: "Tidigare svar" },
      {
        role: "user",
        content:
          '[Användaren hänvisar till följande markerade text:\n"markerad text"]\n\nAnvändarens fråga: Ny fråga',
      },
    ]);
  });

  it("passes the selected effort and yields only text deltas", async () => {
    const create = mock(async () =>
      (async function* () {
        yield { type: "response.created" };
        yield { type: "response.output_text.delta", delta: "Hej" };
        yield { type: "response.output_text.delta", delta: " världen" };
        yield { type: "response.completed" };
      })(),
    );
    const client = { responses: { create } } as any;

    const chunks: string[] = [];
    for await (const chunk of streamOpenAIResponse(
      "Systemprompt",
      [{ role: "user", content: "Fråga" }],
      LUNA_CHAT_MODEL_ID,
      [],
      [],
      "Fråga",
      undefined,
      LONG_CACHE_KEY,
      false,
      "medium",
      client,
    )) {
      if (chunk.type === "text") chunks.push(chunk.delta);
    }

    expect(chunks).toEqual(["Hej", " världen"]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: LUNA_CHAT_MODEL_ID,
        instructions: "Systemprompt",
        max_output_tokens: 16000,
        reasoning: { effort: "medium" },
        store: false,
        stream: true,
      }),
    );
  });

  it("hashes the cache key to fit OpenAI's 64-char cap, stably", async () => {
    const seen: any[] = [];
    const create = async (params: any) => {
      seen.push(params);
      return (async function* () {
        yield { type: "response.completed" };
      })();
    };
    const run = (key: string) =>
      (async () => {
        for await (const _ of streamOpenAIResponse(
          "S", [{ role: "user", content: "F" }], LUNA_CHAT_MODEL_ID, [], [], "F",
          undefined, key, false, "low", { responses: { create } } as any,
        )) { /* drained */ }
      })();

    expect(LONG_CACHE_KEY.length).toBeGreaterThan(64);
    await run(LONG_CACHE_KEY);
    await run(LONG_CACHE_KEY);
    await run(LONG_CACHE_KEY + "-other");

    expect(seen[0].prompt_cache_key.length).toBeLessThanOrEqual(64);
    // Same exam must route to the same cache, or the hint is worthless.
    expect(seen[1].prompt_cache_key).toBe(seen[0].prompt_cache_key);
    // Different exam must not collide onto it.
    expect(seen[2].prompt_cache_key).not.toBe(seen[0].prompt_cache_key);
  });

  it("omits the web_search tool unless the turn asked for it", async () => {
    const calls: any[] = [];
    const create = async (params: any) => {
      calls.push(params);
      return (async function* () {
        yield { type: "response.completed" };
      })();
    };

    for (const webSearch of [false, true]) {
      for await (const _ of streamOpenAIResponse(
        "Systemprompt",
        [{ role: "user", content: "Fråga" }],
        LUNA_CHAT_MODEL_ID,
        [],
        [],
        "Fråga",
        undefined,
        undefined,
        webSearch,
        "low",
        { responses: { create } } as any,
      )) {
        // drained for its side effect on `calls`
      }
    }

    // The tool call carries a per-call fee, so an untoggled turn must not be
    // able to incur one no matter what the model would have chosen to do.
    expect(calls[0]).not.toHaveProperty("tools");
    expect(calls[1].tools).toEqual([
      { type: "web_search", search_context_size: "low" },
    ]);
  });

  it("turns web search lifecycle events into status and source events", async () => {
    const create = async () =>
      (async function* () {
        yield { type: "response.web_search_call.in_progress" };
        yield { type: "response.web_search_call.searching" };
        yield { type: "response.web_search_call.completed" };
        yield {
          type: "response.output_text.annotation.added",
          annotation: {
            type: "url_citation",
            url: "https://liu.se/tenta",
            title: "Tentaperioder",
          },
        };
        // Duplicate citation of the same page must not produce a second chip.
        yield {
          type: "response.output_text.annotation.added",
          annotation: {
            type: "url_citation",
            url: "https://liu.se/tenta",
            title: "Tentaperioder",
          },
        };
        yield { type: "response.output_text.delta", delta: "Svar" };
        yield { type: "response.completed" };
      })();

    const events: any[] = [];
    for await (const event of streamOpenAIResponse(
      "Systemprompt",
      [{ role: "user", content: "Fråga" }],
      TERRA_CHAT_MODEL_ID,
      [],
      [],
      "Fråga",
      undefined,
      undefined,
      true,
      "high",
      { responses: { create } } as any,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "status", step: "searching", message: "Söker på webben" },
      { type: "status", step: "search_done", message: "Läser källor" },
      { type: "text", delta: "Svar" },
      {
        type: "sources",
        items: [{ title: "Tentaperioder", url: "https://liu.se/tenta" }],
      },
    ]);
  });

  it("omits the prompt cache key when there is none to pin on", async () => {
    const create = mock(async () =>
      (async function* () {
        yield { type: "response.completed" };
      })(),
    );

    for await (const _ of streamOpenAIResponse(
      "Systemprompt",
      [{ role: "user", content: "Fråga" }],
      LUNA_CHAT_MODEL_ID,
      [],
      [],
      "Fråga",
      undefined,
      undefined,
      false,
      "low",
      { responses: { create } } as any,
    )) {
      // drained for its side effect on `create`
    }

    expect(create.mock.calls[0]![0]).not.toHaveProperty("prompt_cache_key");
  });
});
