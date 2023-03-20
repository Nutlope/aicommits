async function retrieveGitmojis(): Promise<
	Array<{ emoji: string; description: string }>
	> {
	const response = await fetch('https://gitmoji.dev/api/gitmojis');
	const data = await response.json();
	const gitmojis = data.gitmojis.map(
		(gitmoji: { emoji: string; description: string }) => ({
			emoji: gitmoji.emoji,
			description: gitmoji.description,
		}),
	);
	return gitmojis;
}

export { retrieveGitmojis };
