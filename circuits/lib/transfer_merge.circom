pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/comparators.circom";
include "./utils.circom";
include "./slots.circom";

// MergeToCanonical encodes the fixed-upper-bound version of
// MergeToCanonical(e_tx, U_raw, Slots_out) = 1 from spec_poi.md.
// The live matrix is computed by the caller and represents the active retained
// source slots that must be copied into the outputs at the current epoch.
//
// This gadget enforces:
// - Slots_out is well formed
// - every live input occurrence maps to exactly one output slot
// - selected mappings preserve both srcId and enterEpoch
// - every retained output slot is covered by at least one live input slot
//
// If the number of distinct live sources exceeds K, the relation becomes
// unsatisfiable because some live row cannot be mapped consistently.

template MergeToCanonical(MAX_INPUTS, K) {
    // Bitmask selecting which input notes are real.
    signal input inUsed[MAX_INPUTS];
    // Source ids carried by each input note.
    signal input inSrcIds[MAX_INPUTS][K];
    // Entry epochs paired with the input source ids.
    signal input inEnterEpochs[MAX_INPUTS][K];
    // live[i][j] = 1 iff the j-th slot of input i must be copied into Slots_out.
    signal input live[MAX_INPUTS][K];
    // Canonical output source ids shared by all output notes.
    signal input outSrcIds[K];
    // Canonical output entry epochs shared by all output notes.
    signal input outEnterEpochs[K];
    // Selector matrix mapping each live input occurrence to one output slot.
    signal input sel[MAX_INPUTS][K][K];

    component outWellFormed = WellFormedSlots(K);
    for (var k = 0; k < K; k++) {
        outWellFormed.srcIds[k] <== outSrcIds[k];
        outWellFormed.enterEpochs[k] <== outEnterEpochs[k];
    }

    component selBits[MAX_INPUTS][K][K];
    signal rowSum[MAX_INPUTS][K];
    signal coverCount[K];

    for (var i = 0; i < MAX_INPUTS; i++) {
        for (var j = 0; j < K; j++) {
            var rowLc = 0;
            for (var k = 0; k < K; k++) {
                selBits[i][j][k] = AssertBit();
                selBits[i][j][k].in <== sel[i][j][k];

                rowLc += sel[i][j][k];

                sel[i][j][k] * (inSrcIds[i][j] - outSrcIds[k]) === 0;
                sel[i][j][k] * (inEnterEpochs[i][j] - outEnterEpochs[k]) === 0;
            }
            // A live occurrence must be routed once; a non-live occurrence
            // must not contribute to Slots_out.
            rowSum[i][j] <== rowLc;
            rowSum[i][j] === live[i][j];
        }
    }

    component coverIsZero[K];
    for (var k = 0; k < K; k++) {
        var coverLc = 0;
        for (var i = 0; i < MAX_INPUTS; i++) {
            for (var j = 0; j < K; j++) {
                coverLc += sel[i][j][k];
            }
        }

        coverCount[k] <== coverLc;

        coverIsZero[k] = IsZero();
        coverIsZero[k].in <== coverCount[k];
        // Retained output slots must be backed by at least one live input
        // occurrence; padding output slots must have zero cover.
        coverIsZero[k].out + outWellFormed.isRetained[k] === 1;
    }
}
