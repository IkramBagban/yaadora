import { test } from "bun:test";
test("2", async () => { console.log("START 2"); await new Promise(r => setTimeout(r, 1000)); console.log("END 2"); });
