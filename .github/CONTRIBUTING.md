
# Contributing guide

## Setting up the project

Use nvm to set the appropriate Node.js version:
```
nvm i
```

Install the dependencies using pnpm:
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
