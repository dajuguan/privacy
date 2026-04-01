const assert = require("node:assert/strict");

const {
  DEFAULT_DEPTH,
  K,
  buildBlacklistWitness,
  buildFixedDepthProof,
  buildNote,
  disabledBlacklistWitness,
  hash3,
  loadCircuit,
  makeSlots,
  normalizeSignals
} = require("./helpers/fixtures");

describe("UnshieldPOI", function () {
  this.timeout(180000);

  let circuit;

  before(async function () {
    circuit = await loadCircuit("unshield_poi.circom");
  });

  async function buildInput({
    amount = 30n,
    ask = 7n,
    rho = 50n,
    recipient = 901n,
    slots = makeSlots([[21n, 0n]]),
    blacklistKeys = [],
    eNow = 10n
  } = {}) {
    const note = await buildNote({ amount, ask, rho, srcIds: slots.srcIds, enterEpochs: slots.enterEpochs });
    const noteProof = await buildFixedDepthProof(note.noteCommit, 0, DEFAULT_DEPTH, 0n);
    const withdrawCommit = await hash3(amount, recipient, note.nf);

    const witnesses = Array.from({ length: K }, () => disabledBlacklistWitness());
    for (let i = 0; i < K; i += 1) {
      if (slots.srcIds[i] !== 0n) {
        witnesses[i] = await buildBlacklistWitness(blacklistKeys, slots.srcIds[i], DEFAULT_DEPTH);
      }
    }

    return normalizeSignals({
      root_note: noteProof.root,
      root_blk: (await buildBlacklistWitness(blacklistKeys, 1n, DEFAULT_DEPTH)).root,
      e_now: eNow,
      nf: note.nf,
      withdrawCommit,
      amount,
      rho,
      ask,
      recipient,
      srcIds: slots.srcIds,
      enterEpochs: slots.enterEpochs,
      notePathSiblings: noteProof.siblings,
      notePathIndices: noteProof.pathIndices,
      nmLowLeafKey: witnesses.map((entry) => entry.lowLeafKey),
      nmLowLeafNextKey: witnesses.map((entry) => entry.lowLeafNextKey),
      nmPathSiblings: witnesses.map((entry) => entry.siblings),
      nmPathIndices: witnesses.map((entry) => entry.pathIndices)
    });
  }

  it("accepts clean retained sources including one older than T", async function () {
    const input = await buildInput();
    await circuit.calculateWitness(input, true);
  });

  it("rejects a blacklisted retained source older than T", async function () {
    const input = await buildInput({ blacklistKeys: [21n] });
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a broken note inclusion path", async function () {
    const input = await buildInput();
    input.notePathSiblings[0] = "1";
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a wrong ask witness", async function () {
    const input = await buildInput();
    input.ask = "999";
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a mismatched withdraw commitment", async function () {
    const input = await buildInput();
    input.withdrawCommit = "123";
    await assert.rejects(circuit.calculateWitness(input, true));
  });
});
