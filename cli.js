#! /usr/bin/env node
import { main } from "./lib";

(async () => {
  await main(process.cwd());
})();
