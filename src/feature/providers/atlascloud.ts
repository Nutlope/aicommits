import { ProviderDef } from './base.js';

export const AtlasCloudProvider: ProviderDef = {
	name: 'atlascloud',
	displayName: 'Atlas Cloud',
	baseUrl: 'https://api.atlascloud.ai/v1',
	apiKeyFormat: 'apikey-',
	// The catalog reports output_modalities ["text"] for the image and OCR
	// models too, so those have to be filtered out by id rather than by that
	// field.
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					m.id &&
					!/image|video|embed|rerank|tts|whisper|ocr/i.test(m.id),
			)
			.map((m: any) => m.id),
	// Checked against the live API before being written down. Cheap, fast
	// models first: a commit message is a short completion.
	defaultModels: [
		'deepseek-ai/deepseek-v4-flash',
		'zai-org/glm-5.3-flash',
		'qwen/qwen3.5-flash',
		'moonshotai/kimi-k2.6',
	],
	requiresApiKey: true,
};
