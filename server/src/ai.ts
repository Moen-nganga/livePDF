const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
// Using the "latest" alias rather than a pinned version (e.g.
// gemini-2.5-flash) on purpose -- Google deprecates specific model
// versions fairly often, and a pinned name eventually 404s for new API
// keys once it's phased out. This alias always points at whichever Flash
// model Google currently recommends, so it keeps working without needing
// a code change every time they ship a new one.
const MODEL = 'gemini-flash-latest';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const SYSTEM_INSTRUCTION = `You are a helpful assistant embedded inside a PDF editor web app, shown as a small chat widget. Users ask you things like how to use a feature, or questions about the document they're currently editing. Keep answers concise and practical. If document content is provided below, use it to answer questions about what's actually in the document -- otherwise just help generally with using the editor.`;

// Caps to keep individual requests reasonable -- this proxies straight
// through to Gemini's free tier, which is rate-limited per day, so a
// single runaway conversation (or someone pasting a huge document)
// shouldn't be able to burn through the whole daily quota by itself.
const MAX_MESSAGES = 20;
const MAX_DOCUMENT_CONTEXT_CHARS = 8000;
const MAX_MESSAGE_CHARS = 2000;

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

export async function getChatReply(
  messages: ChatMessage[],
  documentContext: string | undefined
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set on the server');
  }

  const trimmedMessages = messages
    .slice(-MAX_MESSAGES)
    .map((m) => ({ ...m, text: m.text.slice(0, MAX_MESSAGE_CHARS) }));

  const systemText = documentContext
    ? `${SYSTEM_INSTRUCTION}\n\nCurrent document content:\n${documentContext.slice(0, MAX_DOCUMENT_CONTEXT_CHARS)}`
    : SYSTEM_INSTRUCTION;

  const res = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: trimmedMessages.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof reply !== 'string') {
    throw new Error('Gemini API returned an unexpected response shape');
  }
  return reply;
}