import { describe, expect, it } from "vitest";
import { resolveBoundSessionModelSelection } from "./binding.js";

describe("resolveBoundSessionModelSelection", () => {
  it("prefers the bound session store provider and model", () => {
    const resolved = resolveBoundSessionModelSelection({
      agentId: "main",
      config: {},
      existing: {
        provider: "openai-codex",
        model: "gpt-5.4",
      },
    });

    expect(resolved).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
  });

  it("falls back to the agent-specific configured primary model", () => {
    const resolved = resolveBoundSessionModelSelection({
      agentId: "main",
      config: {
        agents: {
          defaults: {
            model: {
              primary: "openai/gpt-5.4",
            },
          },
          entries: {
            main: {
              model: {
                primary: "openai-codex/gpt-5.4",
              },
            },
          },
        },
      },
    });

    expect(resolved).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
  });

  it("falls back to the global configured primary model when the session has no model metadata", () => {
    const resolved = resolveBoundSessionModelSelection({
      agentId: "main",
      config: {
        agents: {
          defaults: {
            model: {
              primary: "openai-codex/gpt-5.4",
            },
          },
        },
      },
    });

    expect(resolved).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
    });
  });
});
