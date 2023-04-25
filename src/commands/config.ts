import { command } from 'cleye';
import { red } from 'kolorist';
import { hasOwn, getConfig, setConfigs } from '../utils/config.js';
import { KnownError, handleCliError } from '../utils/error.js';

export default command({
	name: 'config',

	parameters: ['<mode>', '<key=value...>'],
}, (argv) => {
	(async () => {
		const { mode, keyValue: keyValues } = argv._;

		if (mode === 'get') {
			const config = await getConfig({}, true);
			for (const key of keyValues) {
				if (hasOwn(config, key)) {
					console.log(`${key}=${config[key as keyof typeof config]}`);
				}
			}
			return;
		}

		if (mode === 'set') {
			await setConfigs(
				keyValues.map(keyValue => keyValue.split('=') as [string, string]),
			);
			return;
		}

		throw new KnownError(`Invalid mode: ${mode}`);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		handleCliError(error);
		process.exit(1);
	});
});
