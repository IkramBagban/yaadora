import { test } from "bun:test";
test("1", async () => { console.log("START 1"); await new Promise(r => setTimeout(r, 1000)); console.log("END 1"); });
