#!/usr/bin/env node

import { ensureAllCircuitSetups, ensurePtau } from "./groth16";

function printUsage(): void {
  console.error("Usage: ts-node scripts/setup_groth16.ts <ptau|zkeys>");
}

function main(): void {
  const command = process.argv[2];

  if (command === "ptau") {
    ensurePtau();
    return;
  }

  if (command === "zkeys") {
    ensureAllCircuitSetups();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main();
