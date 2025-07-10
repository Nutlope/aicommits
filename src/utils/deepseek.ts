import https from "https";
import type { ClientRequest, IncomingMessage } from "http";
import HttpsProxyAgent from "https-proxy-agent";
import { Agent } from "http";
import { KnownError } from "./error.js";
import type { CommitType } from "./config.js";
import { generatePrompt } from "./prompt.js";

interface DeepSeekChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface DeepSeekChatCompletionRequest {
	model: string;
	messages: DeepSeekChatMessage[];
	temperature?: number;
	top_p?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	max_tokens?: number;
	stream?: boolean;
	n?: number;
}

interface DeepSeekChatCompletionChoice {
	index: number;
	message: {
		role: string;
		content: string;
	};
	finish_reason: string;
}

interface DeepSeekChatCompletionResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: DeepSeekChatCompletionChoice[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

// 在httpsPost函数中
const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string,
) =>
	new Promise<{
		request: ClientRequest;
		response: IncomingMessage;
		data: string;
	}>((resolve, reject) => {
		const postContent = JSON.stringify(json);
		const options = {
			port: 443,
			hostname,
			path,
			method: "POST",
			headers: {
				...headers,
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(postContent),
			},
			timeout,
			agent: proxy ? (new HttpsProxyAgent(proxy) as any) : undefined,
		};

		const request = https.request(options, (response) => {
			const body: Buffer[] = [];
			response.on("data", (chunk) => body.push(chunk));
			response.on("end", () => {
				resolve({
					request,
					response,
					data: Buffer.concat(body).toString(),
				});
			});
		});
		request.on("error", reject);
		request.on("timeout", () => {
			request.destroy();
			reject(
				new KnownError(
					`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking the DeepSeek API status.`,
				),
			);
		});

		request.write(postContent);
		request.end();
	});

const createDeepSeekChatCompletion = async (
	apiKey: string,
	json: DeepSeekChatCompletionRequest,
	timeout: number,
	proxy?: string,
) => {
	const { response, data } = await httpsPost(
		"api.deepseek.com",
		"/v1/chat/completions",
		{
			Authorization: `Bearer ${apiKey}`,
		},
		json,
		timeout,
		proxy,
	);

	if (
		!response.statusCode ||
		response.statusCode < 200 ||
		response.statusCode > 299
	) {
		let errorMessage = `DeepSeek API Error: ${response.statusCode} - ${response.statusMessage}`;

		if (data) {
			errorMessage += `\n\n${data}`;
		}

		if (response.statusCode === 500) {
			errorMessage += "\n\nCheck the DeepSeek API status.";
		}

		throw new KnownError(errorMessage);
	}

	return JSON.parse(data) as DeepSeekChatCompletionResponse;
};

const sanitizeMessage = (message: string) =>
	message
		.trim()
		.replace(/[\n\r]/g, "")
		.replace(/(\w)\.$/, "$1");

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export const generateDeepSeekCommitMessage = async (
	apiKey: string,
	model: string,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number,
	proxy?: string,
) => {
	try {
		const completion = await createDeepSeekChatCompletion(
			apiKey,
			{
				model,
				messages: [
					{
						role: "system",
						content: generatePrompt(locale, maxLength, type),
					},
					{
						role: "user",
						content: diff,
					},
				],
				temperature: 0.7,
				top_p: 1,
				frequency_penalty: 0,
				presence_penalty: 0,
				max_tokens: 200,
				stream: false,
				n: completions,
			},
			timeout,
			proxy,
		);

		return deduplicateMessages(
			completion.choices
				.filter((choice) => choice.message?.content)
				.map((choice) => sanitizeMessage(choice.message.content as string)),
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === "ENOTFOUND") {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`,
			);
		}

		throw errorAsAny;
	}
};
