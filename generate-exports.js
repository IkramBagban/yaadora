const client = Object.keys(require("./packages/db/client.ts"));
const schema = Object.keys(require("./packages/db/schema/index.ts"));
const queries = Object.keys(require("./packages/db/queries.ts"));
console.log(`export { ${client.join(", ")} } from "./client";`);
console.log(`export { ${schema.join(", ")} } from "./schema";`);
console.log(`export { ${queries.join(", ")} } from "./queries";`);
