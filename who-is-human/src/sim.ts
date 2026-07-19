import "dotenv/config";
import { createGame } from "./engine/setup.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { DemoAgentProvider } from "./agents/demoProvider.js";
import { buildProviders, resolveBackend } from "./agents/factory.js";
import { isLocale } from "./i18n/catalog.js";
import type { GameEvent } from "./orchestrator/events.js";

// Play a full game headlessly. The "human" slot is driven by a demo agent so no
// interactive input is needed — useful for smoke-testing the whole loop.
//   npm run sim            → random seed, demo backend
//   npm run sim -- 42      → seed 42
async function main() {
  const seedArg = process.argv[2];
  const localeArg = process.argv[3];
  const seed = seedArg ? Number(seedArg) : undefined;
  const locale = isLocale(localeArg) ? localeArg : "en";
  const state = createGame({ seed, locale });
  const human = new DemoAgentProvider(); // stand-in so the game self-plays
  const backend = resolveBackend(); // usually demo; api/file also work
  const { providers, effectiveBackend } = buildProviders(state, human, backend);

  console.log(`\n=== Who is Human — sim (seed ${state.config.seed}, backend ${effectiveBackend}, locale ${locale}) ===`);
  console.log(`Hidden human: ${state.humanId} (${state.players.find((p) => p.id === state.humanId)!.role})\n`);

  const orch = new Orchestrator(state, providers, {
    emit: (e: GameEvent) => print(e),
    log: () => {},
  });
  await orch.run();
}

function print(e: GameEvent) {
  if (e.type === "transcript") {
    const who = e.entry.speaker ?? "MODERATOR";
    console.log(`${who}: ${e.entry.text}`);
  } else if (e.type === "result") {
    const r = e.result;
    console.log("\n--- REVEAL ---");
    for (const p of e.reveal) console.log(`  ${p.id}${p.isYou ? " (HUMAN)" : ""}: ${p.revealedRole}`);
    console.log(
      `\nFINAL: ${r.finalOutcome.toUpperCase()}  |  faction ${r.humanFactionWon ? "won" : "lost/drew"}  |  detected ${r.humanDetected} (${r.votesAgainstHuman}/6, need ${r.detectionThreshold})  |  score ${r.score}/2\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
