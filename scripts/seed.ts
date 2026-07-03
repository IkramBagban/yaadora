const AUTH_BOOTSTRAP_TOKEN = process.env.AUTH_BOOTSTRAP_TOKEN;

if (!AUTH_BOOTSTRAP_TOKEN) {
  console.error("AUTH_BOOTSTRAP_TOKEN is missing from .env");
  process.exit(1);
}

const SERVER_URL = "http://localhost:3000";

const memories = [
  { rawText: "My name is John.", clientId: "seed-001" },
  { rawText: "My wife's name is Sarah.", clientId: "seed-002" },
  { rawText: "I work as a software engineer.", clientId: "seed-003" },
  { rawText: "I prefer drinking coffee over tea in the morning.", clientId: "seed-004" },
  { rawText: "Had a meeting with the design team today about the new UI.", clientId: "seed-005" },
  { rawText: "Decided to use React for the frontend of the new project.", clientId: "seed-006" },
  { rawText: "I sleep at 11pm.", clientId: "seed-007" }, // Contradiction part 1
  { rawText: "My favorite color is blue.", clientId: "seed-008" },
  { rawText: "I have a dog named Max.", clientId: "seed-009" },
  { rawText: "Need to buy groceries this weekend.", clientId: "seed-010" },
  { rawText: "My goal for this year is to learn rust.", clientId: "seed-011" },
  { rawText: "I am allergic to peanuts.", clientId: "seed-012" },
  { rawText: "I usually sleep past midnight.", clientId: "seed-013" }, // Contradiction part 2 (supersedes 7)
  { rawText: "Sarah loves Italian food.", clientId: "seed-014" },
  { rawText: "Max is a golden retriever.", clientId: "seed-015" },
  { rawText: "Thinking about taking a vacation to Japan.", clientId: "seed-016" },
  { rawText: "My favorite TV show is Breaking Bad.", clientId: "seed-017" },
  { rawText: "I need to renew my passport soon.", clientId: "seed-018" }
];

async function seed() {
  console.log(`Starting seed process with ${memories.length} memories...`);
  
  for (const memory of memories) {
    try {
      const response = await fetch(`${SERVER_URL}/memories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AUTH_BOOTSTRAP_TOKEN}`
        },
        body: JSON.stringify(memory)
      });
      
      if (!response.ok) {
        console.error(`Failed to seed memory: ${memory.rawText}`);
        console.error(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.error(`Response: ${text}`);
      } else {
        const data = await response.json();
        console.log(`Seeded [Status ${response.status}]: ${memory.clientId} -> ID: ${data.id}`);
      }
    } catch (error) {
      console.error(`Error sending memory: ${memory.rawText}`, error);
    }
  }
  
  console.log("Seed process completed.");
}

seed();
