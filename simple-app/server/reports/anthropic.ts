// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Claude client — minimal REST wrapper for the report-generation
// flow. Uses axios (already a project dep) rather than the official SDK to
// keep the dependency surface small.
//
// Prompt caching is enabled on the static system prompt so re-runs of similar
// reports hit Anthropic's cache and cost ~10× less per token.
// ─────────────────────────────────────────────────────────────────────────────

import axios, { AxiosError } from "axios";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";

export interface AnthropicCallInput {
  systemPrompt: string;
  userMessage: string;
  /** Optional override for cost/quality tradeoff. */
  model?: string;
  /** Max output tokens; reports rarely need more than ~2k. */
  maxTokens?: number;
}

export interface AnthropicCallResult {
  text: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function callClaude(input: AnthropicCallInput): Promise<AnthropicCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. Add it to Railway env vars."
    );
  }

  const model = input.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // System prompt gets cache_control: ephemeral, which marks the whole block
  // as cacheable. Anthropic's caching layer matches identical prefixes across
  // calls and returns them at ~1/10th the input-token cost.
  const body = {
    model,
    max_tokens: input.maxTokens ?? 2048,
    system: [
      {
        type: "text",
        text: input.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: input.userMessage,
      },
    ],
  };

  try {
    const res = await axios.post(ANTHROPIC_URL, body, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // Long timeout because reports can take 20-40s
      timeout: 90_000,
      validateStatus: (s) => s < 500,
    });

    if (res.status !== 200) {
      const errBody = res.data;
      throw new Error(
        `Anthropic API returned ${res.status}: ${
          typeof errBody === "string" ? errBody : JSON.stringify(errBody).slice(0, 500)
        }`
      );
    }

    const data = res.data as {
      content: { type: string; text?: string }[];
      model: string;
      usage: AnthropicCallResult["usage"];
    };

    const text = (data.content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    return {
      text,
      model: data.model ?? model,
      usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
    };
  } catch (err) {
    const ax = err as AxiosError;
    if (ax.code === "ECONNABORTED") {
      throw new Error("Anthropic call timed out after 90s. Try again or use a faster model.");
    }
    throw err;
  }
}
