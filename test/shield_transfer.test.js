const assert = require("node:assert/strict");

const {
  DEFAULT_DEPTH,
  K,
  MAX_INPUTS,
  MAX_OUTPUTS,
  T_WINDOW,
  buildBinaryProof,
  buildBlacklistWitness,
  buildNote,
  buildSlotsRoot,
  emptyBlacklistTensor,
  emptyTransferSelectors,
  hash4,
  loadCircuit,
  makeSlots,
  normalizeSignals,
  zeroArray
} = require("./helpers/fixtures");

describe("ShieldTransfer", function () {
  this.timeout(180000);

  let circuit;

  before(async function () {
    circuit = await loadCircuit("shield_transfer.circom");
  });

  async function buildTransferCase({
    inputNotes,
    outputNotes,
    outSlots,
    eTx = 5n,
    blacklistKeys = [],
    selectors
  }) {
    const noteLeaves = zeroArray(1 << DEFAULT_DEPTH, 0n);
    const proofs = [];

    for (let i = 0; i < inputNotes.length; i += 1) {
      noteLeaves[i] = inputNotes[i].noteCommit;
    }

    for (let i = 0; i < inputNotes.length; i += 1) {
      proofs.push(await buildBinaryProof(noteLeaves, i));
    }

    const rootNote = proofs[0].root;
    const blacklistRoot = (await buildBlacklistWitness(blacklistKeys, 1n, DEFAULT_DEPTH)).root;
    const outputSourcesRoot = await buildSlotsRoot(outSlots.srcIds, outSlots.enterEpochs);
    const nmTensor = emptyBlacklistTensor();

    for (let i = 0; i < MAX_INPUTS; i += 1) {
      for (let j = 0; j < K; j += 1) {
        if (i < inputNotes.length && inputNotes[i].srcIds[j] !== 0n) {
          nmTensor[i][j] = await buildBlacklistWitness(blacklistKeys, inputNotes[i].srcIds[j], DEFAULT_DEPTH);
        }
      }
    }

    const amountIn = zeroArray(MAX_INPUTS);
    const rhoIn = zeroArray(MAX_INPUTS);
    const askIn = zeroArray(MAX_INPUTS);
    const inSrcIds = Array.from({ length: MAX_INPUTS }, () => zeroArray(K));
    const inEnterEpochs = Array.from({ length: MAX_INPUTS }, () => zeroArray(K));
    const notePathSiblings = Array.from({ length: MAX_INPUTS }, () => zeroArray(DEFAULT_DEPTH));
    const notePathIndices = Array.from({ length: MAX_INPUTS }, () => zeroArray(DEFAULT_DEPTH));
    const inUsed = zeroArray(MAX_INPUTS);
    const nf = zeroArray(MAX_INPUTS);

    for (let i = 0; i < inputNotes.length; i += 1) {
      inUsed[i] = 1n;
      amountIn[i] = inputNotes[i].amount;
      rhoIn[i] = inputNotes[i].rho;
      askIn[i] = inputNotes[i].ask;
      inSrcIds[i] = [...inputNotes[i].srcIds];
      inEnterEpochs[i] = [...inputNotes[i].enterEpochs];
      notePathSiblings[i] = [...proofs[i].siblings];
      notePathIndices[i] = [...proofs[i].pathIndices];
      nf[i] = inputNotes[i].nf;
    }

    const amountOut = zeroArray(MAX_OUTPUTS);
    const ownerCommitOut = zeroArray(MAX_OUTPUTS);
    const rhoOut = zeroArray(MAX_OUTPUTS);
    const outUsed = zeroArray(MAX_OUTPUTS);
    const noteCommitOut = zeroArray(MAX_OUTPUTS);

    for (let j = 0; j < outputNotes.length; j += 1) {
      outUsed[j] = 1n;
      amountOut[j] = outputNotes[j].amount;
      ownerCommitOut[j] = outputNotes[j].ownerCommit;
      rhoOut[j] = outputNotes[j].rho;
      noteCommitOut[j] = await hash4(outputNotes[j].amount, outputNotes[j].ownerCommit, outputNotes[j].rho, outputSourcesRoot);
    }

    return normalizeSignals({
      root_note: rootNote,
      root_blk: blacklistRoot,
      e_tx: eTx,
      inUsed,
      outUsed,
      nf,
      noteCommitOut,
      amountIn,
      rhoIn,
      askIn,
      inSrcIds,
      inEnterEpochs,
      notePathSiblings,
      notePathIndices,
      amountOut,
      ownerCommitOut,
      rhoOut,
      outSrcIds: outSlots.srcIds,
      outEnterEpochs: outSlots.enterEpochs,
      sel: selectors,
      nmLowLeafKey: nmTensor.map((row) => row.map((entry) => entry.lowLeafKey)),
      nmLowLeafNextKey: nmTensor.map((row) => row.map((entry) => entry.lowLeafNextKey)),
      nmPathSiblings: nmTensor.map((row) => row.map((entry) => entry.siblings)),
      nmPathIndices: nmTensor.map((row) => row.map((entry) => entry.pathIndices))
    });
  }

  async function buildNoteWithSlots({ amount, ask, rho, slots }) {
    return buildNote({ amount, ask, rho, srcIds: slots.srcIds, enterEpochs: slots.enterEpochs });
  }

  it("accepts a one-input split transfer with one active source", async function () {
    const slots = makeSlots([[11n, 4n]]);
    const inputNote = await buildNoteWithSlots({ amount: 30n, ask: 7n, rho: 19n, slots });
    const selectors = emptyTransferSelectors();
    selectors[0][0][0] = 1n;

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
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

    const input = await buildTransferCase({
      inputNotes: [inputNote],
      outputNotes: [{ amount: 31n, ownerCommit: 909n, rho: 39n }],
      outSlots: slots,
      selectors
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });

  it("rejects overflow beyond K active unique sources", async function () {
    const slotsA = makeSlots(
      Array.from({ length: K }, (_, index) => [BigInt(index + 1), 4n])
    );
    const slotsB = makeSlots([[99n, 4n]]);
    const noteA = await buildNoteWithSlots({ amount: 16n, ask: 10n, rho: 40n, slots: slotsA });
    const noteB = await buildNoteWithSlots({ amount: 14n, ask: 11n, rho: 41n, slots: slotsB });
    const selectors = emptyTransferSelectors();
    for (let index = 0; index < K; index += 1) {
      selectors[0][index][index] = 1n;
    }

    const input = await buildTransferCase({
      inputNotes: [noteA, noteB],
      outputNotes: [{ amount: 30n, ownerCommit: 1001n, rho: 42n }],
      outSlots: slotsA,
      selectors
    });

    await assert.rejects(circuit.calculateWitness(input, true));
  });
});
