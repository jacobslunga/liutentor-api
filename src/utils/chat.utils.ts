import { GoogleGenAI, ThinkingLevel as GeminiThinkingLevel } from "@google/genai";
import { LRUCache } from "lru-cache";
import type { ValidatedChatAttachment } from "~/api/v1/chat.attachments";
import type { ThinkingLevel } from "~/api/v1/chat.models";

export interface PdfData {
  data: string;
  mimeType: "application/pdf";
  label: "tenta" | "facit";
}

export interface ChatSource {
  title: string;
  url: string;
}

/**
 * The provider generators used to yield plain strings, which left no room to say
 * anything about a turn other than its text. Web search means a turn now does
 * visible work before it answers, so they yield framed events instead and the
 * route decides how to put them on the wire.
 */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "status"; step: "searching" | "search_done"; message: string }
  | { type: "sources"; items: ChatSource[] };

function getPdfLabelText(label: "tenta" | "facit"): string {
  return label === "tenta"
    ? "Bifogad PDF: tentan med uppgifterna. Lös endast det användaren uttryckligen ber om."
    : "Bifogad PDF: facit. Använd endast som referens när användaren frågar om en specifik uppgift, och redovisa aldrig lösningar oombedd.";
}

function getUserAttachmentLabelText(filename: string): string {
  return `Material som användaren själv har bifogat (${filename}). Använd det som kontext för den aktuella frågan.`;
}

export function buildGeminiAttachmentParts(
  userAttachments: ValidatedChatAttachment[],
) {
  return userAttachments.flatMap((attachment) => [
    { text: getUserAttachmentLabelText(attachment.filename) },
    {
      inlineData: {
        mimeType: attachment.mediaType,
        data: attachment.data,
      },
    },
  ]);
}

const googleAi = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
});

const geminiCacheStore = new LRUCache<string, string>({
  max: 100,
  ttl: 55 * 60 * 1000,
});

const GEMINI_THINKING_LEVELS: Record<ThinkingLevel, GeminiThinkingLevel> = {
  minimal: GeminiThinkingLevel.MINIMAL,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH,
};

async function* streamGeminiResponse(
  systemPrompt: string,
  messages: any[],
  modelId: string,
  pdfs: PdfData[],
  userAttachments: ValidatedChatAttachment[],
  lastMsgText: string,
  selectionContext?: string,
  cacheKey?: string,
  webSearch = false,
  thinkingLevel: ThinkingLevel = "minimal",
  client: Pick<GoogleGenAI, "models"> = googleAi,
): AsyncGenerator<ChatStreamEvent> {
  const history = messages
    .slice(0, -1)
    .map((message: any) => {
      const role = message?.role === "assistant" ? "model" : "user";
      let text = "";
      if (Array.isArray(message?.content)) {
        text = message.content
          .filter(
            (part: any) =>
              part?.type === "text" && typeof part?.text === "string",
          )
          .map((part: any) => part.text)
          .join("\n");
      } else if (typeof message?.content === "string") {
        text = message.content;
      }
      return {
        role,
        parts: [{ text }],
      };
    })
    .filter((msg) => msg.parts[0]?.text.length > 0);

  const lastMsgWithContext = selectionContext
    ? `[Användaren hänvisar till följande markerade text:\n"${selectionContext}"]\n\nAnvändarens fråga: ${lastMsgText}`
    : `Användarens fråga: ${lastMsgText}`;

  const attachmentParts = buildGeminiAttachmentParts(userAttachments);

  const lastUserTurn = {
    role: "user",
    parts: [...attachmentParts, { text: lastMsgWithContext }],
  };

  let cachedContentName: string | undefined = undefined;

  // An explicit cache fixes its tool set at creation time, so a cached entry
  // built without googleSearch cannot be reused for a grounded turn. Search-on
  // turns are the rare case, so they inline the PDFs instead of forcing a second
  // cache variant keyed by search.
  if (pdfs.length > 0 && cacheKey && !webSearch) {
    const fullCacheKey = `${modelId}:${cacheKey}`;
    const cached = geminiCacheStore.get(fullCacheKey);
    if (cached) {
      cachedContentName = cached;
    } else {
      try {
        const pdfParts = pdfs.flatMap((pdf) => [
          { text: getPdfLabelText(pdf.label) },
          {
            inlineData: {
              mimeType: pdf.mimeType,
              data: pdf.data,
            },
          },
        ]);
        const createdCache = await googleAi.caches.create({
          model: modelId,
          config: {
            systemInstruction: systemPrompt,
            contents: [
              {
                role: "user",
                parts: pdfParts,
              },
            ],
            ttl: "3600s",
          },
        });
        if (createdCache?.name) {
          cachedContentName = createdCache.name;
          geminiCacheStore.set(fullCacheKey, cachedContentName);
        }
      } catch (err: any) {
        console.debug("Gemini context caching fallback:", err?.message || err);
      }
    }
  }

  let contents: any[] = [];
  if (!cachedContentName && pdfs.length > 0) {
    const pdfParts = pdfs.flatMap((pdf) => [
      { text: getPdfLabelText(pdf.label) },
      {
        inlineData: {
          mimeType: pdf.mimeType,
          data: pdf.data,
        },
      },
    ]);
    contents = [
      {
        role: "user",
        parts: pdfParts,
      },
      {
        role: "model",
        parts: [{ text: "Jag har läst igenom de bifogade filerna." }],
      },
      ...history,
      lastUserTurn,
    ];
  } else {
    contents = [...history, lastUserTurn];
  }

  const responseStream = await client.models.generateContentStream({
    model: modelId,
    contents,
    config: {
      ...(cachedContentName
        ? { cachedContent: cachedContentName }
        : { systemInstruction: systemPrompt }),
      thinkingConfig: {
        thinkingLevel: GEMINI_THINKING_LEVELS[thinkingLevel],
      },
      ...(webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  });

  // Gemini gives no in-progress signal: the search runs server side and only
  // surfaces in groundingMetadata, often on a late chunk. So this
  // status is optimistic — we say "searching" the moment the request is out, then
  // either refine it with the real query or clear it when text starts arriving.
  if (webSearch) {
    yield { type: "status", step: "searching", message: "Söker på webben" };
  }

  const sources = new Map<string, ChatSource>();
  let searching = webSearch;

  for await (const chunk of responseStream) {
    const grounding = chunk.candidates?.[0]?.groundingMetadata;

    if (grounding) {
      for (const groundingChunk of grounding.groundingChunks ?? []) {
        const url = groundingChunk.web?.uri;
        if (url && !sources.has(url)) {
          sources.set(url, { title: groundingChunk.web?.title || url, url });
        }
      }
    }

    if (chunk.text) {
      if (searching) {
        searching = false;
        yield { type: "status", step: "search_done", message: "Läser källor" };
      }
      yield { type: "text", delta: chunk.text };
    }
  }

  if (searching) {
    yield { type: "status", step: "search_done", message: "" };
  }
  if (sources.size > 0) {
    yield { type: "sources", items: [...sources.values()] };
  }
}

export { streamGeminiResponse };
