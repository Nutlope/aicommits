
# Contributing guide

## Setting up the project

Simply install the dependencies using pnpm:
```
pnpm i
```

## Producing a build
Run the `build` script:
```
pnpm build
```

The package is bundled using [pkgroll](https://github.com/privatenumber/pkgroll) (Rollup). It infers the entry-points from `package.json` so there are no build configurations.


### Watch mode
During development, you can use the watch flag (`--watch, -w`) to automatically rebuild the package on file changes:
```
pnpm build -w
```

## Running the package locally
Since pkgroll knows the entry-point is a binary (being in `package.json#bin`), it automatically adds the Node.js hashbang to the top of the file, and chmods it so it's executable.

You can run the distribution file in any directory:
```
./dist/cli.mjs
```

Or in non UNIX environments, you can use Node.js to run the file:
```
node ./dist/cli.mjs
```

## Testing the package
After commiting your changes, you can create a test release via GitHub using [`git-publish`](https://github.com/privatenumber/git-publish):

```
$ pnpm dlx git-publish
✔ Successfully published branch! Install with command:
  → npm i 'privatenumber/aicommits#npm/main'
```

You can test it out in any project like this:
```
pnpm dlx 'privatenumber/aicommits#npm/main'
```

Or using npx:
```
npx 'privatenumber/aicommits#npm/main'
```
