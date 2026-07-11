import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';
import { OpenRouterProvider } from './openrouter.js';
import { RequestyProvider } from './requesty.js';
import { LMStudioProvider } from './lmstudio.js';
import { GroqProvider } from './groq.js';
import { XAiProvider } from './xai.js';

export const providers = [
	TogetherProvider,
	OpenAiProvider,
	GroqProvider,
	XAiProvider,
	OpenRouterProvider,
	RequestyProvider,
	OllamaProvider,
	LMStudioProvider,
	OpenAiCustom,
];
