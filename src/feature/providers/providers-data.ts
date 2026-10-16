import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';
import { OpenRouterProvider } from './openrouter.js';
import { LMStudioProvider } from './lmstudio.js';
import { GroqProvider } from './groq.js';
import { XAiProvider } from './xai.js';
import { ClaudeAgentProvider } from './claude-agent.js';
import { CodexProvider } from './codex.js';
import { OpenCodeGoProvider } from './opencode-go.js';
import { AnthropicProvider } from './anthropic.js';

export const providers = [
	ClaudeAgentProvider,
	CodexProvider,
	OpenCodeGoProvider,
	TogetherProvider,
	OpenAiProvider,
	AnthropicProvider,
	GroqProvider,
	XAiProvider,
	OllamaProvider,
	LMStudioProvider,
	OpenRouterProvider,
	OpenAiCustom,
];
