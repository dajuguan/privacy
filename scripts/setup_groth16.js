#!/usr/bin/env node

const { ensureAllCircuitSetups, ensurePtau } = require("./groth16");

function printUsage() {
  console.error("Usage: node scripts/setup_groth16.js <ptau|zkeys>");
}

function main() {
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
