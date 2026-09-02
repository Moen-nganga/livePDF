const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
const MODEL = 'openai/gpt-oss-120b';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const SYSTEM_INSTRUCTION = `You are a helpful assistant embedded inside a PDF editor web app, shown as a small chat widget. Users ask you things like how to use a feature, or questions about the document they're currently editing. Keep answers concise and practical. If document content is provided below, use it to answer questions about what's actually in the document -- otherwise just help generally with using the editor.`;

const MAX_MESSAGES = 20;
const MAX_DOCUMENT_CONTEXT_CHARS = 8000;
const MAX_MESSAGE_CHARS = 2000;

// Retry config for transient failures (rate limits, overloaded model, network blips)
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

// Groq uses the OpenAI chat-completions shape: role is 'user' | 'assistant' | 'system',
// not the 'model' role Gemini used. We translate at the boundary so the rest of the
// app (ChatMessage, the widget, index.ts) doesn't need to know or care.
type GroqRole = 'system' | 'user' | 'assistant';

interface GroqChatCompletionResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A user-facing error. Thrown once retries are exhausted (or for
// non-retryable failures) so index.ts can show something better than
// a generic 500.
export class ChatServiceError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ChatServiceError';
  }
}

function toGroqRole(role: ChatMessage['role']): GroqRole {
  return role === 'model' ? 'assistant' : 'user';
}

async function callGroq(systemText: string, trimmedMessages: ChatMessage[]): Promise<Response> {
  return fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemText },
        ...trimmedMessages.map((m) => ({
          role: toGroqRole(m.role),
          content: m.text,
        })),
      ],
    }),
  });
}

export async function getChatReply(
  messages: ChatMessage[],
  documentContext: string | undefined
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new ChatServiceError('GROQ_API_KEY is not set on the server', false);
  }

  const trimmedMessages = messages
    .slice(-MAX_MESSAGES)
    .map((m) => ({ ...m, text: m.text.slice(0, MAX_MESSAGE_CHARS) }));

  const systemText = documentContext
    ? `${SYSTEM_INSTRUCTION}\n\nCurrent document content:\n${documentContext.slice(0, MAX_DOCUMENT_CONTEXT_CHARS)}`
    : SYSTEM_INSTRUCTION;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await callGroq(systemText, trimmedMessages);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const retryable = RETRYABLE_STATUS_CODES.has(res.status);

        if (retryable && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * 2 ** attempt; // 500ms, 1s, 2s
          console.warn(
            `Groq API ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
          );
          await sleep(delay);
          continue;
        }

        throw new ChatServiceError(
          `Groq API error (${res.status}): ${errBody.slice(0, 300)}`,
          retryable
        );
      }

      const data = (await res.json()) as GroqChatCompletionResponse;
      const reply = data?.choices?.[0]?.message?.content;
      if (typeof reply !== 'string') {
        throw new ChatServiceError('Groq API returned an unexpected response shape', false);
      }
      return reply;
    } catch (err) {
      lastError = err;
      // Network-level failures (fetch throwing) are also worth retrying
      if (!(err instanceof ChatServiceError) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        console.warn(`Groq request failed, retrying in ${delay}ms:`, err);
        await sleep(delay);
        continue;
      }
      break;
    }
  }

  if (lastError instanceof ChatServiceError) throw lastError;
  throw new ChatServiceError(
    lastError instanceof Error ? lastError.message : 'Failed to reach the AI service',
    true
  );
}