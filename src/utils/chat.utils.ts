import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import type { ValidatedChatAttachment } from "~/api/v1/chat.attachments";
import type { ReasoningEffort } from "~/api/v1/chat.models";

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export function buildOpenAIInput(
  messages: any[],
  pdfs: PdfData[],
  userAttachments: ValidatedChatAttachment[],
  lastMsgText: string,
  selectionContext?: string,
): ResponseInput {
  const history: ResponseInput = messages
    .slice(0, -1)
    .map((message: any) => {
      const role: "user" | "assistant" =
        message?.role === "assistant" ? "assistant" : "user";
      let content = "";

      if (Array.isArray(message?.content)) {
        content = message.content
          .filter(
            (part: any) =>
              part?.type === "text" && typeof part?.text === "string",
          )
          .map((part: any) => part.text)
          .join("\n");
      } else if (typeof message?.content === "string") {
        content = message.content;
      }

      return { role, content };
    })
    .filter(
      (message) =>
        typeof message.content === "string" && message.content.length > 0,
    );

  const lastMsgWithContext = selectionContext
    ? `[Användaren hänvisar till följande markerade text:\n"${selectionContext}"]\n\nAnvändarens fråga: ${lastMsgText}`
    : `Användarens fråga: ${lastMsgText}`;

  const userAttachmentParts = userAttachments.flatMap((attachment) => [
    {
      type: "input_text" as const,
      text: getUserAttachmentLabelText(attachment.filename),
    },
    attachment.mediaType === "application/pdf"
      ? {
          type: "input_file" as const,
          filename: attachment.filename,
          file_data: `data:${attachment.mediaType};base64,${attachment.data}`,
        }
      : {
          type: "input_image" as const,
          image_url: `data:${attachment.mediaType};base64,${attachment.data}`,
          detail: "auto" as const,
        },
  ]);

  const conversationMessages: ResponseInput = [
    ...history,
    {
      role: "user",
      content:
        userAttachmentParts.length > 0
          ? [
              ...userAttachmentParts,
              { type: "input_text", text: lastMsgWithContext },
            ]
          : lastMsgWithContext,
    },
  ];

  if (pdfs.length === 0) return conversationMessages;

  return [
    {
      role: "user",
      content: pdfs.flatMap((pdf) => [
        { type: "input_text" as const, text: getPdfLabelText(pdf.label) },
        {
          type: "input_file" as const,
          filename: `${pdf.label}.pdf`,
          file_data: `data:${pdf.mimeType};base64,${pdf.data}`,
          detail: "auto" as const,
        },
      ]),
    },
    {
      role: "assistant",
      content: "Jag har läst igenom de bifogade filerna.",
    },
    ...conversationMessages,
  ];
}

/**
 * OpenAI caps `prompt_cache_key` at 64 characters, and the conversation cache key
 * is a pair of full storage URLs. Hashing keeps it stable per exam+facit — which
 * is all the routing hint needs — while fitting the limit.
 */
function toPromptCacheKey(cacheKey: string): string {
  return createHash("sha256").update(cacheKey).digest("hex").slice(0, 32);
}

async function* streamOpenAIResponse(
  systemPrompt: string,
  messages: any[],
  modelId: string,
  pdfs: PdfData[],
  userAttachments: ValidatedChatAttachment[],
  lastMsgText: string,
  selectionContext?: string,
  cacheKey?: string,
  webSearch = false,
  effort: ReasoningEffort = "low",
  client: Pick<OpenAI, "responses"> = openai,
): AsyncGenerator<ChatStreamEvent> {
  const responseStream = await client.responses.create({
    model: modelId,
    instructions: systemPrompt,
    input: buildOpenAIInput(
      messages,
      pdfs,
      userAttachments,
      lastMsgText,
      selectionContext,
    ),
    max_output_tokens: 16000,
    // The tier a student picks is meant to buy more thinking, not just a bigger
    // model, so the effort comes from the tier rather than from the model ID.
    reasoning: { effort },
    // Automatic prompt caching keys off the prefix, but the hit rate depends on
    // same-prefix requests routing together. The exam PDFs are that prefix, so
    // their cache key is the right routing hint.
    ...(cacheKey ? { prompt_cache_key: toPromptCacheKey(cacheKey) } : {}),
    // "low" context keeps the search-content block that gets billed into the
    // prompt small. A tenta question needs a fact, not a literature review.
    ...(webSearch
      ? {
          tools: [
            { type: "web_search" as const, search_context_size: "low" as const },
          ],
        }
      : {}),
    store: false,
    stream: true,
  });

  const sources = new Map<string, ChatSource>();
  let searching = false;

  for await (const event of responseStream) {
    switch (event.type) {
      // OpenAI does not reveal the query until the search has already finished
      // (the item carries `action.query` only on output_item.done, after
      // .completed), so there is no honest way to name it while it runs. The
      // status therefore stays generic.
      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
        if (searching) break;
        searching = true;
        yield { type: "status", step: "searching", message: "Söker på webben" };
        break;

      case "response.web_search_call.completed":
        searching = false;
        yield { type: "status", step: "search_done", message: "Läser källor" };
        break;

      case "response.output_text.annotation.added": {
        const annotation = event.annotation as any;
        if (annotation?.type !== "url_citation" || !annotation.url) break;
        if (!sources.has(annotation.url)) {
          sources.set(annotation.url, {
            title: annotation.title || annotation.url,
            url: annotation.url,
          });
        }
        break;
      }

      case "response.output_text.delta":
        if (event.delta) yield { type: "text", delta: event.delta };
        break;
    }
  }

  if (searching) {
    yield { type: "status", step: "search_done", message: "" };
  }
  if (sources.size > 0) {
    yield { type: "sources", items: [...sources.values()] };
  }
}

export { streamOpenAIResponse };
