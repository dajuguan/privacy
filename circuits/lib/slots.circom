pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/comparators.circom";
include "./utils.circom";
include "./commitments.circom";
include "./binary_merkle.circom";

// WellFormedSlots implements the source-slot invariant from spec_poi.md:
// - padding slots are exactly (0, 0)
// - retained slots come before padding slots
// - retained slots are strictly increasing by srcId
// The output bit isRetained[i] is 1 iff srcIds[i] != 0.

template WellFormedSlots(K) {
    // Source ids for the K retained slots of a note.
    signal input srcIds[K];
    // Protocol-entry epochs paired with srcIds.
    signal input enterEpochs[K];
    signal output isRetained[K];

    component srcRanges[K];
    component epochRanges[K];
    component isZeroSrc[K];

    for (var i = 0; i < K; i++) {
        srcRanges[i] = RangeCheck(64);
        srcRanges[i].in <== srcIds[i];

        epochRanges[i] = RangeCheck(64);
        epochRanges[i].in <== enterEpochs[i];

        isZeroSrc[i] = IsZero();
        isZeroSrc[i].in <== srcIds[i];
        isRetained[i] <== 1 - isZeroSrc[i].out;

        isZeroSrc[i].out * enterEpochs[i] === 0;
    }

    component order[K - 1];
    for (var i = 0; i < K - 1; i++) {
        isZeroSrc[i].out * isRetained[i + 1] === 0;

        order[i] = LessThan(64);
        order[i].in[0] <== srcIds[i];
        order[i].in[1] <== srcIds[i + 1];
        isRetained[i + 1] * (order[i].out - 1) === 0;
    }
}

template SlotsRoot(K) {
    // Source ids for the K retained slots whose root is being committed.
    signal input srcIds[K];
    // Entry epochs paired with srcIds for the source-slot root.
    signal input enterEpochs[K];
    signal output root;

    // The retained source state of a note is committed as a binary Merkle root
    // over exactly K slot leaves, including padding slots.
    signal leaves[K];
    component srcLeaves[K];

    for (var i = 0; i < K; i++) {
        srcLeaves[i] = SourceLeaf();
        srcLeaves[i].srcId <== srcIds[i];
        srcLeaves[i].enterEpoch <== enterEpochs[i];
        leaves[i] <== srcLeaves[i].out;
    }

    component merkleRoot = BinaryMerkleRoot(K);
    for (var i = 0; i < K; i++) {
        merkleRoot.leaves[i] <== leaves[i];
    }

    root <== merkleRoot.root;
}
