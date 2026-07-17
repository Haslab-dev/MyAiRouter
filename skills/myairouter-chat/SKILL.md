---
name: myAiRouter Chat Capability
description: Multi-turn conversations and code completions. Supports standard OpenAI chat completions parameters.
---

# myAiRouter Chat Completions

Exposes an OpenAI-compatible endpoint at `/v1/chat/completions`.

## Parameters

- `model`: resolved to target provider or combo fallbacks.
- `messages`: conversation history array.
- `stream`: streaming toggle.
- `max_tokens`: token response limit.
- `temperature`: randomness parameter.
