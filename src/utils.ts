import { Configuration, OpenAIApi } from 'openai';

export const generateCommitMessage = async (
	apiKey: string,
	prompt: string,
) => {
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
			n: 1,
		});

		return completion.data.choices[0].text!.trim().replace(/[\n\r]/g, '');
	} catch (error) {
		const errorAsAny = error as any;
		errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
		throw errorAsAny;
	}
};
