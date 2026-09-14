#!/usr/bin/env node
import { main } from "../src/main.ts";

const code = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr });
process.exit(code);
