import type { TiktokenModel } from "@dqbd/tiktoken";
import { generateOpenAICommitMessage } from "./openai.js";
import { generateDeepSeekCommitMessage } from "./deepseek.js";
import type { CommitType, APIProvider } from "./config.js";
import { KnownError } from "./error.js";

/**
 * 统一的 commit message 生成函数
 * 根据配置选择使用 OpenAI 或 DeepSeek 的 API
 */
export const generateCommitMessage = async (
	apiKey: string,
	model: string | TiktokenModel,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number,
	proxy?: string,
	provider: APIProvider = "openai",
) => {
	try {
		if (provider === "openai") {
			return await generateOpenAICommitMessage(
				apiKey,
				model as TiktokenModel,
				locale,
				diff,
				completions,
				maxLength,
				type,
				timeout,
				proxy,
			);
		} else if (provider === "deepseek") {
			return await generateDeepSeekCommitMessage(
				apiKey,
				model || "deepseek-chat",
				locale,
				diff,
				completions,
				maxLength,
				type,
				timeout,
				proxy,
			);
		} else {
			throw new KnownError("Unsupported API provider");
		}
	} catch (error) {
		// 传递错误到调用方
		throw error;
	}
};
