import assert from "node:assert/strict";

import type { CircomWasmTester } from "circom_tester";

import { buildShieldAspCase } from "./helpers/cases";
import { loadCircuit } from "./helpers/fixtures";

interface ShieldAspInput {
  noteCommit: string;
  ask: string;
  path_dep_siblings: string[];
  [key: string]: unknown;
}

describe("ShieldASP", function (this: Mocha.Suite) {
  this.timeout(180000);

  let circuit: CircomWasmTester;

  before(async function () {
    circuit = await loadCircuit("shield_asp.circom");
  });

  it("accepts a valid deposit inclusion and blacklist non-membership proof", async function () {
    const { input } = await buildShieldAspCase();
    await circuit.calculateWitness(input, true);
  });

  it("rejects a blacklisted deposit index", async function () {
    const { input } = await buildShieldAspCase({ blacklistKeys: [9n] });
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a broken deposit path", async function () {
    const { input } = await buildShieldAspCase();
    const mutatedInput = input as ShieldAspInput;
    mutatedInput.path_dep_siblings[0] = "1";
    await assert.rejects(circuit.calculateWitness(mutatedInput, true));
  });

  it("rejects a wrong ask witness", async function () {
    const { input } = await buildShieldAspCase();
    const mutatedInput = input as ShieldAspInput;
    mutatedInput.ask = "99";
    await assert.rejects(circuit.calculateWitness(mutatedInput, true));
  });

  it("rejects a mismatched public note commitment", async function () {
    const { input, noteCommit } = await buildShieldAspCase();
    const mutatedInput = input as ShieldAspInput;
    mutatedInput.noteCommit = (noteCommit + 1n).toString();
    await assert.rejects(circuit.calculateWitness(mutatedInput, true));
  });
});
