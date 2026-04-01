import assert from "node:assert/strict";

import type { CircomWasmTester } from "circom_tester";

import { buildUnshieldCase } from "./helpers/cases";
import { loadCircuit } from "./helpers/fixtures";

interface UnshieldInput {
  withdrawCommit: string;
  ask: string;
  notePathSiblings: string[];
  [key: string]: unknown;
}

describe("UnshieldPOI", function (this: Mocha.Suite) {
  this.timeout(180000);

  let circuit: CircomWasmTester;

  before(async function () {
    circuit = await loadCircuit("unshield_poi.circom");
  });

  it("accepts clean retained sources including one older than T", async function () {
    const input = await buildUnshieldCase();
    await circuit.calculateWitness(input, true);
  });

  it("rejects a blacklisted retained source older than T", async function () {
    const input = await buildUnshieldCase({ blacklistKeys: [21n] });
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a broken note inclusion path", async function () {
    const input = await buildUnshieldCase();
    const mutatedInput = input as UnshieldInput;
    mutatedInput.notePathSiblings[0] = "1";
    await assert.rejects(circuit.calculateWitness(mutatedInput, true));
  });

  it("rejects a wrong ask witness", async function () {
    const input = await buildUnshieldCase();
    const mutatedInput = input as UnshieldInput;
    mutatedInput.ask = "999";
    await assert.rejects(circuit.calculateWitness(mutatedInput, true));
  });

  it("rejects a mismatched withdraw commitment", async function () {
    const input = await buildUnshieldCase();
    const mutatedInput = input as UnshieldInput;
    mutatedInput.withdrawCommit = "123";
    await assert.rejects(circuit.calculateWitness(mutatedInput, true));
  });
});
