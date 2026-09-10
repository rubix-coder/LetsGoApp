/* The HTTP half of cover recognition. Untested by design, like bookApi.

   Calls the Anthropic Messages API straight from the browser, which needs the
   `anthropic-dangerous-direct-browser-access` header — without it the request
   is blocked by CORS. That is acceptable here precisely because the key is
   the user's own and never leaves their device: there is no shared server
   key to protect. */

import { claudeKey } from "./apiKeys";
import { MAX_IMAGE_EDGE, VISION_PROMPT, type VisionGateway } from "./coverVision";
import type { WebRescueGateway } from "./bookWebRescue";
import type { BookLinkGateway } from "./bookLink";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Reading a cover is extraction, not reasoning — no thinking budget, and a
    small output cap since the reply is one short JSON object. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 512;

/** Long enough for a large image on a phone connection, short enough that a
    dead network does not hang the scanner. */
const TIMEOUT_MS = 30_000;

export class ClaudeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ClaudeApiError";
  }
}

export function hasClaudeKey(): boolean {
  return claudeKey() !== "";
}

export const httpVisionGateway: VisionGateway = {
  async identify(imageBase64, mediaType) {
    const key = claudeKey();
    if (!key) throw new ClaudeApiError(0, "No Claude API key — add one in Settings → Library.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": API_VERSION,
          // Required for browser calls; without it the browser blocks on CORS.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: VISION_PROMPT },
            ],
          }],
        }),
      });
      if (!res.ok) {
        throw new ClaudeApiError(res.status, await describe(res));
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ClaudeApiError) throw err;
      throw new ClaudeApiError(0, err instanceof Error ? err.message : "network error");
    } finally {
      clearTimeout(timer);
    }
  },
};

/* Server-side tools: the same Messages API with Anthropic's own web search
   and web fetch tools — Anthropic runs them; one round trip from here.
   Searching and fetching take real time, hence the longer timeout, and the
   server loop can pause mid-turn (`stop_reason: "pause_turn"`), which is
   resumed by re-sending the conversation with the assistant turn appended. */
const WEB_SEARCH_TIMEOUT_MS = 90_000;
/** Thinking + search-result blocks + the JSON answer all share this cap. */
const WEB_SEARCH_MAX_TOKENS = 8_000;
const WEB_SEARCH_MAX_CONTINUATIONS = 2;

/** One prompt through a server-tool-equipped model, resuming the server's own
    tool loop when it pauses mid-turn.

    Shared by the two server-tool callers below, which differ only in which
    tools they hand the model. */
async function askWithServerTools(prompt: string, tools: unknown[]): Promise<unknown> {
  const key = claudeKey();
  if (!key) throw new ClaudeApiError(0, "No Claude API key — add one in Settings → Library.");

  const messages: unknown[] = [{ role: "user", content: prompt }];
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: WEB_SEARCH_MAX_TOKENS,
          tools,
          messages,
        }),
      });
      if (!res.ok) throw new ClaudeApiError(res.status, await describe(res));
      const body = await res.json() as { stop_reason?: unknown; content?: unknown };
      if (body?.stop_reason === "pause_turn" && attempt < WEB_SEARCH_MAX_CONTINUATIONS) {
        messages.push({ role: "assistant", content: body.content });
        continue;
      }
      return body;
    } catch (err) {
      if (err instanceof ClaudeApiError) throw err;
      throw new ClaudeApiError(0, err instanceof Error ? err.message : "network error");
    } finally {
      clearTimeout(timer);
    }
  }
}

export const httpWebRescueGateway: WebRescueGateway = {
  search: (prompt) => askWithServerTools(prompt, [
    { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  ]),
};

/* Adding a wishlist book from a pasted link.

   Both tools, deliberately. `web_fetch` reads the page the user actually
   pasted — the accurate answer when it works — and `web_search` is the
   fallback for the retailers that block automated fetches, which is most of
   them and Amazon nearly always. Web fetch will only retrieve URLs already
   present in the conversation, so the pasted link (and anything search turns
   up) is fetchable, and nothing else is. No `allowed_domains`: short links
   like amzn.eu redirect to a different host, and pinning the fetcher to the
   pasted hostname would break exactly the links people share most. */
export const httpBookLinkGateway: BookLinkGateway = {
  read: (prompt) => askWithServerTools(prompt, [
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
    { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  ]),
};

/** Anthropic returns a JSON error envelope; surface its message rather than a
    bare status, since "credit balance too low" is something the user can act
    on and "400" is not. */
async function describe(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const message = (body as { error?: { message?: string } })?.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    /* fall through to the generic wording */
  }
  if (res.status === 401) return "That Claude API key was rejected.";
  if (res.status === 429) return "Claude is rate-limiting — wait a moment and try again.";
  return `Claude API error ${res.status}.`;
}

export function claudeApiMessage(err: unknown): string {
  if (err instanceof ClaudeApiError) return err.message;
  return "Cover recognition failed.";
}

/** Downscales a frame or a file to a JPEG the model can read cheaply.

    Returns bare base64 with no data-URI prefix, which is what the API wants.
    Lives here rather than in coverVision because it needs a canvas. */
export async function toJpegBase64(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ClaudeApiError(0, "Could not read the image.");
  ctx.drawImage(source, 0, 0, w, h);
  // 0.82 keeps cover text crisp; higher mostly buys file size.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Loads a picked file into something drawable. */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ClaudeApiError(0, "That file is not an image.")); };
    img.src = url;
  });
}
