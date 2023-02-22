import { command } from 'cleye';
import { red } from 'kolorist';
import { getConfig, setConfigs } from '../utils/config.js';

export default command({
	name: 'config',

	parameters: ['<mode>', '<key=value...>'],
}, (argv) => {
	(async () => {
		const { mode, keyValue: keyValues } = argv._;

		if (mode === 'get') {
			const config = await getConfig();
			for (const key of keyValues) {
				console.log(`${key}=${config[key as keyof typeof config]}`);
			}
			return;
		}

		if (mode === 'set') {
			await setConfigs(
				keyValues.map(keyValue => keyValue.split('=') as [string, string]),
			);
			return;
		}

		throw new Error(`Invalid mode: ${mode}`);
	})().catch((error) => {
		console.error(`${red('✖')} ${error.message}`);
		process.exit(1);
	});
});
