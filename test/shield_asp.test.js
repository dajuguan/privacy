const assert = require("node:assert/strict");

const {
  DEFAULT_DEPTH,
  buildBlacklistWitness,
  buildDeposit,
  buildFixedDepthProof,
  buildSlotsRoot,
  loadCircuit,
  makeSlots,
  normalizeSignals,
  hash1,
  hash4
} = require("./helpers/fixtures");

describe("ShieldASP", function () {
  this.timeout(180000);

  let circuit;

  before(async function () {
    circuit = await loadCircuit("shield_asp.circom");
  });

  async function buildInput({ depositIndex = 9n, amount = 30n, ask = 7n, depositSecret = 12n, blacklistKeys = [] } = {}) {
    const deposit = await buildDeposit({ depositIndex, amount, ask, depositSecret });
    const depProof = await buildFixedDepthProof(deposit.depLeaf, Number(depositIndex - 1n), DEFAULT_DEPTH, 0n);
    const blacklistWitness = await buildBlacklistWitness(blacklistKeys, depositIndex, DEFAULT_DEPTH);
    const slots = makeSlots([[depositIndex, 5n]]);
    const sourcesRoot = await buildSlotsRoot(slots.srcIds, slots.enterEpochs);
    const noteCommit = await hash4(amount, await hash1(ask), depositSecret, sourcesRoot);

    return {
      input: normalizeSignals({
        root_dep: depProof.root,
        root_blk: blacklistWitness.root,
        e_shield: 5n,
        noteCommit,
        depositIndex,
        amount,
        depositSecret,
        ask,
        path_dep_siblings: depProof.siblings,
        path_dep_indices: depProof.pathIndices,
        blk_low_leaf_key: blacklistWitness.lowLeafKey,
        blk_low_leaf_next_key: blacklistWitness.lowLeafNextKey,
        blk_path_siblings: blacklistWitness.siblings,
        blk_path_indices: blacklistWitness.pathIndices
      }),
      noteCommit
    };
  }

  it("accepts a valid deposit inclusion and blacklist non-membership proof", async function () {
    const { input } = await buildInput();
    await circuit.calculateWitness(input, true);
  });

  it("rejects a blacklisted deposit index", async function () {
    const { input } = await buildInput({ blacklistKeys: [9n] });
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a broken deposit path", async function () {
    const { input } = await buildInput();
    input.path_dep_siblings[0] = "1";
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a wrong ask witness", async function () {
    const { input } = await buildInput();
    input.ask = "99";
    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects a mismatched public note commitment", async function () {
    const { input, noteCommit } = await buildInput();
    input.noteCommit = (noteCommit + 1n).toString();
    await assert.rejects(circuit.calculateWitness(input, true));
  });
});
