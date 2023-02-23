import { Configuration, OpenAIApi } from 'openai';

const sanitizeMessage = (message: string) => message.trim().replace(/[\n\r]/g, '').replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const getPrompt = (locale: string, diff: string) => `Write an insightful but concise Git commit message in a complete sentence in present tense for the following diff without prefacing it with anything, the response must be in the language ${locale}:\n${diff}`;

export const generateCommitMessage = async (
	apiKey: string,
	locale: string,
	diff: string,
	completions: number,
) => {
	const prompt = getPrompt(locale, diff);

	// Accounting for GPT-3's input req of 4k tokens (approx 8k chars)
	if (prompt.length > 8000) {
		throw new Error('The diff is too large for the OpenAI API. Try reducing the number of staged changes, or write your own commit message.');
	}

	const openai = new OpenAIApi(new Configuration({ apiKey }));
	try {
		const completion = await openai.createCompletion({
			model: 'text-davinci-003',
			prompt,
			temperature: 0.7,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
			max_tokens: 200,
			stream: false,
			n: completions,
		});

		return deduplicateMessages(
			completion.data.choices
				.map(choice => sanitizeMessage(choice.text!)),
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new Error(`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`);
		}

		errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
		throw errorAsAny;
	}
};
