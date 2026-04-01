import assert from "node:assert/strict";

import type { CircomWasmTester } from "circom_tester";

import { buildNoteWithSlots, buildShieldTransferCase, T_WINDOW } from "./helpers/cases";
import { K, emptyTransferSelectors, loadCircuit, makeSlots } from "./helpers/fixtures";

describe("ShieldTransfer", function (this: Mocha.Suite) {
  this.timeout(180000);

  let circuit: CircomWasmTester;

  before(async function () {
    circuit = await loadCircuit("shield_transfer.circom");
  });

  it("accepts a one-input split transfer with one active source", async function () {
    const slots = makeSlots([[11n, 4n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 19n, slots });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [
        { amount: 10n, ownerCommit: 101n, rho: 31n },
        { amount: 20n, ownerCommit: 202n, rho: 32n }
      ],
      outSlots: slots,
      selectors
    });

    await circuit.calculateWitness(input, true);
  });

  it("accepts pruning an old retained source when it is not blacklisted", async function () {
    const slots = makeSlots([[12n, 0n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 20n, slots });

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [{ amount: 30n, ownerCommit: 303n, rho: 33n }],
      outSlots: makeSlots([]),
      selectors: emptyTransferSelectors(),
      eTx: T_WINDOW + 2n
    });

    await circuit.calculateWitness(input, true);
  });

  it("rejects a blacklisted retained source even when it would age out of outputs", async function () {
    const slots = makeSlots([[13n, 0n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 21n, slots });

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [{ amount: 30n, ownerCommit: 404n, rho: 34n }],
      outSlots: makeSlots([]),
      selectors: emptyTransferSelectors(),
      eTx: T_WINDOW + 2n,
      blacklistKeys: [13n]
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("accepts duplicate active inputs collapsing into one output slot", async function () {
    const sharedSlots = makeSlots([[14n, 3n]]);
    const noteA = await buildNoteWithSlots({ amount: 11n, ask: 8n, rho: 22n, slots: sharedSlots });
    const noteB = await buildNoteWithSlots({ amount: 19n, ask: 9n, rho: 23n, slots: sharedSlots });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;
    selectors[1][0][0] = 1n;

    const input = await buildShieldTransferCase({
      inputNotes: [noteA, noteB],
      outputNotes: [{ amount: 30n, ownerCommit: 505n, rho: 35n }],
      outSlots: sharedSlots,
      selectors
    });

    await circuit.calculateWitness(input, true);
  });

  it("rejects duplicate srcIds with inconsistent enterEpoch values", async function () {
    const noteA = await buildNoteWithSlots({ amount: 11n, ask: 8n, rho: 24n, slots: makeSlots([[15n, 1n]]) });
    const noteB = await buildNoteWithSlots({ amount: 19n, ask: 9n, rho: 25n, slots: makeSlots([[15n, 2n]]) });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;
    selectors[1][0][0] = 1n;

    const input = await buildShieldTransferCase({
      inputNotes: [noteA, noteB],
      outputNotes: [{ amount: 30n, ownerCommit: 606n, rho: 36n }],
      outSlots: makeSlots([[15n, 1n]]),
      selectors
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects omitting a live source from selector coverage", async function () {
    const slots = makeSlots([[16n, 4n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 26n, slots });

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [{ amount: 30n, ownerCommit: 707n, rho: 37n }],
      outSlots: makeSlots([]),
      selectors: emptyTransferSelectors()
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a fabricated output source with no live input cover", async function () {
    const slots = makeSlots([[17n, 4n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 27n, slots });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [{ amount: 30n, ownerCommit: 808n, rho: 38n }],
      outSlots: makeSlots([[17n, 4n], [99n, 4n]]),
      selectors
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects broken amount conservation", async function () {
    const slots = makeSlots([[18n, 4n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 28n, slots });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;

    const input = await buildShieldTransferCase({
      inputNotes: [inputNote],
      outputNotes: [{ amount: 31n, ownerCommit: 909n, rho: 39n }],
      outSlots: slots,
      selectors
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects overflow beyond K active unique sources", async function () {
    const slotsA = makeSlots(Array.from({ length: K }, (_, index) => [BigInt(index + 1), 4n]));
    const slotsB = makeSlots([[99n, 4n]]);
    const noteA = await buildNoteWithSlots({ amount: 16n, ask: 10n, rho: 40n, slots: slotsA });
    const noteB = await buildNoteWithSlots({ amount: 14n, ask: 11n, rho: 41n, slots: slotsB });
    const selectors = emptyTransferSelectors();
    for (let index = 0; index < K; index += 1) {
      selectors[0][index][index] = 1n;
    }

    const input = await buildShieldTransferCase({
      inputNotes: [noteA, noteB],
      outputNotes: [{ amount: 30n, ownerCommit: 1001n, rho: 42n }],
      outSlots: slotsA,
      selectors
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });
});
