pragma circom 2.1.6;

include "./lib/utils.circom";
include "./lib/commitments.circom";
include "./lib/binary_merkle.circom";
include "./lib/indexed_blacklist.circom";
include "./lib/slots.circom";
include "./lib/transfer_merge.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// ShieldTransfer implements retained-slot strict semantics for the
// time-bounded retained-source PoI model.
//
// D_NOTE is the binary note-tree depth, so each used input note supplies a
// path of exactly D_NOTE siblings and D_NOTE direction bits.
// D_BLK is the indexed blacklist tree depth.
//
// The input notes must each be valid notes under root_note. Every retained
// source slot currently present in a used input note must prove blacklist
// non-membership at e_tx, even if that source is older than T_WINDOW.
//
// T_WINDOW only controls whether a retained source is still "live" and thus
// copied into the shared output slot set. The outputs inherit one canonical
// active source array, and all output notes bind to the same sourcesRoot.

template ShieldTransfer(D_NOTE, D_BLK, K, MAX_INPUTS, MAX_OUTPUTS, T_WINDOW) {
    // Public note Merkle root containing all spendable input notes.
    signal input root_note;
    // Public blacklist root at the transfer epoch.
    signal input root_blk;
    // Epoch at which the transfer is evaluated.
    signal input e_tx;
    // Bitmask indicating which input note slots are actually used.
    signal input inUsed[MAX_INPUTS];
    // Bitmask indicating which output note slots are actually used.
    signal input outUsed[MAX_OUTPUTS];
    // Public nullifiers for the used input notes.
    signal input nf[MAX_INPUTS];
    // Public commitments for the output notes.
    signal input noteCommitOut[MAX_OUTPUTS];

    // Amount stored in each candidate input note.
    signal input amountIn[MAX_INPUTS];
    // rho value of each candidate input note.
    signal input rhoIn[MAX_INPUTS];
    // ask witness authorizing each candidate input note.
    signal input askIn[MAX_INPUTS];
    // Retained source ids stored in each input note.
    signal input inSrcIds[MAX_INPUTS][K];
    // Entry epochs paired with the retained input source ids.
    signal input inEnterEpochs[MAX_INPUTS][K];
    // Merkle sibling paths proving input note inclusion in root_note.
    signal input notePathSiblings[MAX_INPUTS][D_NOTE];
    // Path direction bits for each input note inclusion proof.
    signal input notePathIndices[MAX_INPUTS][D_NOTE];

    // Amount assigned to each candidate output note.
    signal input amountOut[MAX_OUTPUTS];
    // Owner commitments for the candidate output notes.
    signal input ownerCommitOut[MAX_OUTPUTS];
    // rho values for the candidate output notes.
    signal input rhoOut[MAX_OUTPUTS];

    // Canonical retained source ids shared by all used outputs.
    signal input outSrcIds[K];
    // Canonical retained source epochs shared by all used outputs.
    signal input outEnterEpochs[K];
    // Selector tensor implementing MergeToCanonical under the fixed upper bound.
    signal input sel[MAX_INPUTS][K][K];

    // Lower predecessor endpoints for retained-slot blacklist witnesses.
    signal input nmLowLeafKey[MAX_INPUTS][K];
    // Upper predecessor endpoints for retained-slot blacklist witnesses.
    signal input nmLowLeafNextKey[MAX_INPUTS][K];
    // Merkle sibling paths for retained-slot blacklist witnesses.
    signal input nmPathSiblings[MAX_INPUTS][K][D_BLK];
    // Path direction bits for retained-slot blacklist witnesses.
    signal input nmPathIndices[MAX_INPUTS][K][D_BLK];

    component eTxRange = RangeCheck(64);
    eTxRange.in <== e_tx;

    component inUsedBits[MAX_INPUTS];
    component outUsedBits[MAX_OUTPUTS];
    signal inputCount;
    signal outputCount;

    var inputLc = 0;
    for (var i = 0; i < MAX_INPUTS; i++) {
        inUsedBits[i] = AssertBit();
        inUsedBits[i].in <== inUsed[i];
        inputLc += inUsed[i];
    }
    inputCount <== inputLc;

    var outputLc = 0;
    for (var j = 0; j < MAX_OUTPUTS; j++) {
        outUsedBits[j] = AssertBit();
        outUsedBits[j].in <== outUsed[j];
        outputLc += outUsed[j];
    }
    outputCount <== outputLc;

    component inputCountNonZero = AssertNonZero();
    inputCountNonZero.in <== inputCount;

    component outputCountNonZero = AssertNonZero();
    outputCountNonZero.in <== outputCount;

    signal live[MAX_INPUTS][K];
    signal retainedAndUsed[MAX_INPUTS][K];
    signal ageWithinWindow[MAX_INPUTS][K];
    signal epochDiff[MAX_INPUTS][K];
    signal amountInSum;
    signal amountOutSum;

    var amountInLc = 0;
    component inputSlots[MAX_INPUTS];
    component inputRoots[MAX_INPUTS];
    component ownerCommitIn[MAX_INPUTS];
    component noteCommitIn[MAX_INPUTS];
    component noteProofs[MAX_INPUTS];
    component nullifiers[MAX_INPUTS];

    component amountInRanges[MAX_INPUTS];
    component rhoInRanges[MAX_INPUTS];
    component askInRanges[MAX_INPUTS];
    component nfZero[MAX_INPUTS];
    component amountZeroIn[MAX_INPUTS];
    component rhoZeroIn[MAX_INPUTS];
    component askZeroIn[MAX_INPUTS];
    component zeroSrc[MAX_INPUTS][K];
    component zeroEpoch[MAX_INPUTS][K];
    component epochLessEqIn[MAX_INPUTS][K];
    component epochCheckIn[MAX_INPUTS][K];
    component ageLessEqIn[MAX_INPUTS][K];
    component nmIn[MAX_INPUTS][K];
    component noteRootCheck[MAX_INPUTS];
    component nfCheck[MAX_INPUTS];

    for (var i = 0; i < MAX_INPUTS; i++) {
        amountInRanges[i] = RangeCheck(128);
        amountInRanges[i].in <== amountIn[i];

        rhoInRanges[i] = RangeCheck(64);
        rhoInRanges[i].in <== rhoIn[i];

        askInRanges[i] = RangeCheck(64);
        askInRanges[i].in <== askIn[i];

        nfZero[i] = EnforceZeroIfDisabled();
        nfZero[i].enabled <== inUsed[i];
        nfZero[i].value <== nf[i];

        amountZeroIn[i] = EnforceZeroIfDisabled();
        amountZeroIn[i].enabled <== inUsed[i];
        amountZeroIn[i].value <== amountIn[i];

        rhoZeroIn[i] = EnforceZeroIfDisabled();
        rhoZeroIn[i].enabled <== inUsed[i];
        rhoZeroIn[i].value <== rhoIn[i];

        askZeroIn[i] = EnforceZeroIfDisabled();
        askZeroIn[i].enabled <== inUsed[i];
        askZeroIn[i].value <== askIn[i];

        inputSlots[i] = WellFormedSlots(K);
        for (var j = 0; j < K; j++) {
            inputSlots[i].srcIds[j] <== inSrcIds[i][j];
            inputSlots[i].enterEpochs[j] <== inEnterEpochs[i][j];
        }

        for (var j = 0; j < K; j++) {
            zeroSrc[i][j] = EnforceZeroIfDisabled();
            zeroSrc[i][j].enabled <== inUsed[i];
            zeroSrc[i][j].value <== inSrcIds[i][j];

            zeroEpoch[i][j] = EnforceZeroIfDisabled();
            zeroEpoch[i][j].enabled <== inUsed[i];
            zeroEpoch[i][j].value <== inEnterEpochs[i][j];

            epochLessEqIn[i][j] = LessEqThan(64);
            epochLessEqIn[i][j].in[0] <== inEnterEpochs[i][j];
            epochLessEqIn[i][j].in[1] <== e_tx;

            retainedAndUsed[i][j] <== inUsed[i] * inputSlots[i].isRetained[j];

            // A retained source slot in a used note must have entered the
            // protocol no later than the current transfer epoch.
            epochCheckIn[i][j] = ForceEqualIfEnabled();
            epochCheckIn[i][j].enabled <== retainedAndUsed[i][j];
            epochCheckIn[i][j].in[0] <== epochLessEqIn[i][j].out;
            epochCheckIn[i][j].in[1] <== 1;

            epochDiff[i][j] <== e_tx - inEnterEpochs[i][j];

            ageLessEqIn[i][j] = LessEqThan(64);
            ageLessEqIn[i][j].in[0] <== epochDiff[i][j];
            ageLessEqIn[i][j].in[1] <== T_WINDOW;
            ageWithinWindow[i][j] <== ageLessEqIn[i][j].out;

            // live = retained AND age <= T_WINDOW. Only live sources are
            // eligible to appear in Slots_out.
            live[i][j] <== retainedAndUsed[i][j] * ageWithinWindow[i][j];

            // Retained-slot strict verification checks every retained source
            // that is still present in the current note, not only live ones.
            nmIn[i][j] = IndexedBlacklistNonMembership(D_BLK);
            nmIn[i][j].enabled <== retainedAndUsed[i][j];
            nmIn[i][j].root <== root_blk;
            nmIn[i][j].srcId <== inSrcIds[i][j];
            nmIn[i][j].lowLeafKey <== nmLowLeafKey[i][j];
            nmIn[i][j].lowLeafNextKey <== nmLowLeafNextKey[i][j];
            for (var d = 0; d < D_BLK; d++) {
                nmIn[i][j].siblings[d] <== nmPathSiblings[i][j][d];
                nmIn[i][j].pathIndices[d] <== nmPathIndices[i][j][d];
            }
        }

        inputRoots[i] = SlotsRoot(K);
        for (var j = 0; j < K; j++) {
            inputRoots[i].srcIds[j] <== inSrcIds[i][j];
            inputRoots[i].enterEpochs[j] <== inEnterEpochs[i][j];
        }

        ownerCommitIn[i] = OwnerCommit();
        ownerCommitIn[i].ask <== askIn[i];

        noteCommitIn[i] = NoteCommit();
        noteCommitIn[i].amount <== amountIn[i];
        noteCommitIn[i].ownerCommit <== ownerCommitIn[i].out;
        noteCommitIn[i].rho <== rhoIn[i];
        noteCommitIn[i].sourcesRoot <== inputRoots[i].root;

        noteProofs[i] = BinaryMerkleProof(D_NOTE);
        noteProofs[i].leaf <== noteCommitIn[i].out;
        for (var d = 0; d < D_NOTE; d++) {
            noteProofs[i].siblings[d] <== notePathSiblings[i][d];
            noteProofs[i].pathIndices[d] <== notePathIndices[i][d];
        }

        noteRootCheck[i] = ForceEqualIfEnabled();
        noteRootCheck[i].enabled <== inUsed[i];
        noteRootCheck[i].in[0] <== noteProofs[i].root;
        noteRootCheck[i].in[1] <== root_note;

        nullifiers[i] = Nullifier();
        nullifiers[i].ask <== askIn[i];
        nullifiers[i].rho <== rhoIn[i];

        nfCheck[i] = ForceEqualIfEnabled();
        nfCheck[i].enabled <== inUsed[i];
        nfCheck[i].in[0] <== nullifiers[i].out;
        nfCheck[i].in[1] <== nf[i];

        amountInLc += amountIn[i];
    }
    amountInSum <== amountInLc;

    component merge = MergeToCanonical(MAX_INPUTS, K);
    for (var i = 0; i < MAX_INPUTS; i++) {
        merge.inUsed[i] <== inUsed[i];
        for (var j = 0; j < K; j++) {
            merge.inSrcIds[i][j] <== inSrcIds[i][j];
            merge.inEnterEpochs[i][j] <== inEnterEpochs[i][j];
            merge.live[i][j] <== live[i][j];
            for (var k = 0; k < K; k++) {
                merge.sel[i][j][k] <== sel[i][j][k];
            }
        }
    }
    for (var k = 0; k < K; k++) {
        merge.outSrcIds[k] <== outSrcIds[k];
        merge.outEnterEpochs[k] <== outEnterEpochs[k];
    }

    // All outputs share the same canonical active source state.
    component outputSlots = WellFormedSlots(K);
    component outputSlotsRoot = SlotsRoot(K);
    for (var k = 0; k < K; k++) {
        outputSlots.srcIds[k] <== outSrcIds[k];
        outputSlots.enterEpochs[k] <== outEnterEpochs[k];
        outputSlotsRoot.srcIds[k] <== outSrcIds[k];
        outputSlotsRoot.enterEpochs[k] <== outEnterEpochs[k];
    }

    var amountOutLc = 0;
    component amountOutRanges[MAX_OUTPUTS];
    component rhoOutRanges[MAX_OUTPUTS];
    component outputNotes[MAX_OUTPUTS];
    component amountOutZero[MAX_OUTPUTS];
    component ownerCommitOutZero[MAX_OUTPUTS];
    component rhoOutZero[MAX_OUTPUTS];
    component noteOutZero[MAX_OUTPUTS];
    component noteOutCheck[MAX_OUTPUTS];

    for (var j = 0; j < MAX_OUTPUTS; j++) {
        amountOutRanges[j] = RangeCheck(128);
        amountOutRanges[j].in <== amountOut[j];

        rhoOutRanges[j] = RangeCheck(64);
        rhoOutRanges[j].in <== rhoOut[j];

        amountOutZero[j] = EnforceZeroIfDisabled();
        amountOutZero[j].enabled <== outUsed[j];
        amountOutZero[j].value <== amountOut[j];

        ownerCommitOutZero[j] = EnforceZeroIfDisabled();
        ownerCommitOutZero[j].enabled <== outUsed[j];
        ownerCommitOutZero[j].value <== ownerCommitOut[j];

        rhoOutZero[j] = EnforceZeroIfDisabled();
        rhoOutZero[j].enabled <== outUsed[j];
        rhoOutZero[j].value <== rhoOut[j];

        noteOutZero[j] = EnforceZeroIfDisabled();
        noteOutZero[j].enabled <== outUsed[j];
        noteOutZero[j].value <== noteCommitOut[j];

        outputNotes[j] = NoteCommit();
        outputNotes[j].amount <== amountOut[j];
        outputNotes[j].ownerCommit <== ownerCommitOut[j];
        outputNotes[j].rho <== rhoOut[j];
        outputNotes[j].sourcesRoot <== outputSlotsRoot.root;

        noteOutCheck[j] = ForceEqualIfEnabled();
        noteOutCheck[j].enabled <== outUsed[j];
        noteOutCheck[j].in[0] <== outputNotes[j].out;
        noteOutCheck[j].in[1] <== noteCommitOut[j];

        amountOutLc += amountOut[j];
    }
    amountOutSum <== amountOutLc;

    // The transfer neither creates nor destroys value.
    amountInSum === amountOutSum;
}

// The default PoC instantiation uses depth-4 binary trees.
component main {public [root_note, root_blk, e_tx, inUsed, outUsed, nf, noteCommitOut]} = ShieldTransfer(4, 4, 16, 2, 2, 4);
