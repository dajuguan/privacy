pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/comparators.circom";
include "./utils.circom";
include "./commitments.circom";
include "./binary_merkle.circom";

// Predecessor-based non-membership for an indexed Merkle blacklist.
// When enabled = 1, the witness proves both:
// 1. H(lowLeafKey, lowLeafNextKey) is included in root.
// 2. lowLeafKey < srcId < lowLeafNextKey.
// This matches the VerifyNonMembership relation in spec_poi.md.

template IndexedBlacklistNonMembership(D) {
    // Enables or disables the non-membership relation for this witness.
    signal input enabled;
    // Indexed blacklist root for the relevant epoch.
    signal input root;
    // Source id whose absence from the blacklist is being proven.
    signal input srcId;
    // Lower endpoint of the predecessor interval witness.
    signal input lowLeafKey;
    // Upper endpoint of the predecessor interval witness.
    signal input lowLeafNextKey;
    // Merkle siblings for the predecessor leaf inclusion proof.
    signal input siblings[D];
    // Path direction bits for the predecessor leaf inclusion proof.
    signal input pathIndices[D];

    component enabledBit = AssertBit();
    enabledBit.in <== enabled;

    component srcRange = RangeCheck(64);
    srcRange.in <== srcId;

    component lowKeyRange = RangeCheck(64);
    lowKeyRange.in <== lowLeafKey;

    component lowNextRange = RangeCheck(64);
    lowNextRange.in <== lowLeafNextKey;

    component lowerBound = LessThan(64);
    lowerBound.in[0] <== lowLeafKey;
    lowerBound.in[1] <== srcId;

    component upperBound = LessThan(64);
    upperBound.in[0] <== srcId;
    upperBound.in[1] <== lowLeafNextKey;

    component checkLower = ForceEqualIfEnabled();
    checkLower.enabled <== enabled;
    checkLower.in[0] <== lowerBound.out;
    checkLower.in[1] <== 1;

    component checkUpper = ForceEqualIfEnabled();
    checkUpper.enabled <== enabled;
    checkUpper.in[0] <== upperBound.out;
    checkUpper.in[1] <== 1;

    component leaf = BlacklistLeaf();
    leaf.lowLeafKey <== lowLeafKey;
    leaf.lowLeafNextKey <== lowLeafNextKey;

    component proof = BinaryMerkleProof(D);
    proof.leaf <== leaf.out;
    for (var i = 0; i < D; i++) {
        proof.siblings[i] <== siblings[i];
        proof.pathIndices[i] <== pathIndices[i];
    }

    component rootCheck = ForceEqualIfEnabled();
    rootCheck.enabled <== enabled;
    rootCheck.in[0] <== proof.root;
    rootCheck.in[1] <== root;
}
