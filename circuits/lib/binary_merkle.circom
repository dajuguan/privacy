pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "./utils.circom";

// Binary Poseidon Merkle helpers used for deposit inclusion, note inclusion,
// and the retained source root.

template BinaryMerkleRoot(N) {
    // Leaf array of a complete binary Poseidon Merkle tree.
    signal input leaves[N];
    signal output root;

    if (N == 1) {
        root <== leaves[0];
    } else {
        component hashes[N / 2];
        signal nextLevel[N / 2];

        for (var i = 0; i < N / 2; i++) {
            hashes[i] = Poseidon(2);
            hashes[i].inputs[0] <== leaves[2 * i];
            hashes[i].inputs[1] <== leaves[2 * i + 1];
            nextLevel[i] <== hashes[i].out;
        }

        component upper = BinaryMerkleRoot(N / 2);
        for (var i = 0; i < N / 2; i++) {
            upper.leaves[i] <== nextLevel[i];
        }

        root <== upper.root;
    }
}

template BinaryMerkleProof(D) {
    // Leaf whose inclusion is being proven.
    signal input leaf;
    // Sibling nodes along the path from leaf to root.
    signal input siblings[D];
    // Path direction bits where 0 = current node on the left, 1 = on the right.
    signal input pathIndices[D];
    signal output root;

    // pathIndices[i] = 0 means the current node is the left child at depth i.
    signal current[D + 1];
    signal left[D];
    signal right[D];

    current[0] <== leaf;

    component pathBits[D];
    component hashes[D];

    for (var i = 0; i < D; i++) {
        pathBits[i] = AssertBit();
        pathBits[i].in <== pathIndices[i];

        left[i] <== current[i] + pathIndices[i] * (siblings[i] - current[i]);
        right[i] <== siblings[i] + pathIndices[i] * (current[i] - siblings[i]);

        hashes[i] = Poseidon(2);
        hashes[i].inputs[0] <== left[i];
        hashes[i].inputs[1] <== right[i];
        current[i + 1] <== hashes[i].out;
    }

    root <== current[D];
}
