const {
  DEFAULT_DEPTH,
  K,
  MAX_INPUTS,
  MAX_OUTPUTS,
  T_WINDOW,
  buildBinaryProof,
  buildBlacklistWitness,
  buildDeposit,
  buildFixedDepthProof,
  buildNote,
  buildSlotsRoot,
  disabledBlacklistWitness,
  emptyBlacklistTensor,
  hash1,
  hash3,
  hash4,
  makeSlots,
  normalizeSignals,
  zeroArray
} = require("./fixtures");

async function buildShieldAspCase({
  depositIndex = 9n,
  amount = 30n,
  ask = 7n,
  depositSecret = 12n,
  blacklistKeys = []
} = {}) {
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

async function buildNoteWithSlots({ amount, ask, rho, slots }) {
  return buildNote({ amount, ask, rho, srcIds: slots.srcIds, enterEpochs: slots.enterEpochs });
}

async function buildShieldTransferCase({
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

async function buildUnshieldCase({
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

module.exports = {
  T_WINDOW,
  buildNoteWithSlots,
  buildShieldAspCase,
  buildShieldTransferCase,
  buildUnshieldCase
};
