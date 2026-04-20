import { GoogleGenAI } from "@google/genai";

export interface PdfData {
  data: string;
  mimeType: "application/pdf";
}

function extractTextContent(content: unknown): string {
  if (Array.isArray(content)) {
    const textPart = content.find(
      (part: any) => part?.type === "text" && typeof part?.text === "string",
    );
    return textPart?.text || "";
  }
  return typeof content === "string" ? content : "";
}

const googleAI = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
});

async function* streamGoogleResponse(
  systemPrompt: string,
  messages: any[],
  modelId: string,
  pdfs: PdfData[],
  lastMsgText: string,
): AsyncGenerator<string> {
  const history = messages
    .slice(0, -1)
    .map((message: any) => {
      const role = message?.role === "assistant" ? "model" : "user";
      if (Array.isArray(message?.content)) {
        return {
          role,
          parts: message.content
            .filter(
              (part: any) =>
                part?.type === "text" && typeof part?.text === "string",
            )
            .map((part: any) => ({ text: part.text })),
        };
      }
      return {
        role,
        parts: [
          { text: typeof message?.content === "string" ? message.content : "" },
        ],
      };
    })
    .filter((msg: any) => Array.isArray(msg.parts) && msg.parts.length > 0);

  const pdfParts = pdfs.map((pdf) => ({
    inlineData: { data: pdf.data, mimeType: pdf.mimeType },
  }));

  const result = await googleAI.models.generateContentStream({
    model: modelId,
    contents: [
      ...(pdfParts.length > 0 ? [{ role: "user", parts: pdfParts }] : []),
      ...history,
      { role: "user", parts: [{ text: lastMsgText }] },
    ],
    config: { systemInstruction: systemPrompt },
  });

  for await (const chunk of result) {
    const text = chunk.text || "";
    if (text) yield text;
  }
}

async function* streamOpenAIResponse(
  systemPrompt: string,
  messages: any[],
  modelId: string,
  pdfs: PdfData[],
  lastMsgText: string,
): AsyncGenerator<string> {
  const pdfContents = pdfs.map((pdf) => ({
    type: "input_file" as const,
    filename: "document.pdf",
    file_data: `data:${pdf.mimeType};base64,${pdf.data}`,
  }));

  const historyMessages = messages.slice(0, -1).map((msg: any) => ({
    role: (msg.role === "assistant" ? "assistant" : "user") as
      | "assistant"
      | "user",
    content: extractTextContent(msg.content),
  }));

  const lastMessage = {
    role: "user" as const,
    content: [
      ...pdfContents,
      { type: "input_text" as const, text: lastMsgText },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      instructions: systemPrompt,
      input: [...historyMessages, lastMessage],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.statusText} — ${errorBody}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.type === "response.output_text.delta") {
          const text = parsed?.delta ?? "";
          if (text) yield text;
        }
      } catch {}
    }
  }
}

export { streamGoogleResponse, streamOpenAIResponse };
