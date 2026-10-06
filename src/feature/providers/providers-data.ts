import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';
import { OpenRouterProvider } from './openrouter.js';
import { LMStudioProvider } from './lmstudio.js';
import { GroqProvider } from './groq.js';
import { AtlasCloudProvider } from './atlascloud.js';
import { XAiProvider } from './xai.js';

export const providers = [
	TogetherProvider,
	OpenAiProvider,
	GroqProvider,
	XAiProvider,
	AtlasCloudProvider,
	OllamaProvider,
	LMStudioProvider,
	OpenRouterProvider,
	OpenAiCustom,
];
