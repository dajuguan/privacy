pragma circom 2.1.6;

include "./lib/utils.circom";
include "./lib/commitments.circom";
include "./lib/binary_merkle.circom";
include "./lib/indexed_blacklist.circom";
include "./lib/slots.circom";

// ShieldASP proves that a public deposit can become a private note while
// attaching initial POI metadata.
//
// D_DEP is the binary deposit-tree depth, so the circuit expects exactly
// D_DEP sibling nodes and D_DEP path bits for the deposit inclusion proof.
// D_BLK is the indexed blacklist tree depth.
//
// Per spec_poi.md, the circuit enforces:
// - the deposit leaf is included in root_dep
// - depositIndex is not blacklisted at e_shield
// - rho is fixed to depositSecret in v1
// - Slots(note) = Pad_K([(depositIndex, e_shield)])
// - the public noteCommit matches the derived private note state

template ShieldASP(D_DEP, D_BLK, K) {
    // Public deposit Merkle root.
    signal input root_dep;
    // Public blacklist root at the shielding epoch.
    signal input root_blk;
    // Epoch in which the deposit enters the private pool.
    signal input e_shield;
    // Public commitment of the newly created private note.
    signal input noteCommit;

    // Public deposit identifier that becomes the first retained source.
    signal input depositIndex;
    // Deposit amount to be carried into the note.
    signal input amount;
    // Deposit randomness; reused as rho in the v1 shielded note.
    signal input depositSecret;
    // Private account secret proving ownership of the new note.
    signal input ask;

    // Merkle sibling path proving inclusion of the deposit leaf in root_dep.
    signal input path_dep_siblings[D_DEP];
    // Path direction bits for the deposit inclusion proof.
    signal input path_dep_indices[D_DEP];

    // Lower endpoint of the predecessor interval for depositIndex.
    signal input blk_low_leaf_key;
    // Upper endpoint of the predecessor interval for depositIndex.
    signal input blk_low_leaf_next_key;
    // Merkle sibling path for the indexed blacklist predecessor leaf.
    signal input blk_path_siblings[D_BLK];
    // Path direction bits for the predecessor leaf inclusion proof.
    signal input blk_path_indices[D_BLK];

    component depositIndexRange = RangeCheck(64);
    depositIndexRange.in <== depositIndex;

    component amountRange = RangeCheck(128);
    amountRange.in <== amount;

    component depositSecretRange = RangeCheck(64);
    depositSecretRange.in <== depositSecret;

    component askRange = RangeCheck(64);
    askRange.in <== ask;

    component epochRange = RangeCheck(64);
    epochRange.in <== e_shield;

    component depositIndexNonZero = AssertNonZero();
    depositIndexNonZero.in <== depositIndex;

    component ownerCommit = OwnerCommit();
    ownerCommit.ask <== ask;

    component depositLeaf = DepositLeaf();
    depositLeaf.depositIndex <== depositIndex;
    depositLeaf.amount <== amount;
    depositLeaf.ownerCommit <== ownerCommit.out;
    depositLeaf.depositSecret <== depositSecret;

    component depProof = BinaryMerkleProof(D_DEP);
    depProof.leaf <== depositLeaf.out;
    for (var i = 0; i < D_DEP; i++) {
        depProof.siblings[i] <== path_dep_siblings[i];
        depProof.pathIndices[i] <== path_dep_indices[i];
    }
    depProof.root === root_dep;

    component nm = IndexedBlacklistNonMembership(D_BLK);
    nm.enabled <== 1;
    nm.root <== root_blk;
    nm.srcId <== depositIndex;
    nm.lowLeafKey <== blk_low_leaf_key;
    nm.lowLeafNextKey <== blk_low_leaf_next_key;
    for (var i = 0; i < D_BLK; i++) {
        nm.siblings[i] <== blk_path_siblings[i];
        nm.pathIndices[i] <== blk_path_indices[i];
    }

    signal srcIds[K];
    signal enterEpochs[K];
    for (var i = 0; i < K; i++) {
        if (i == 0) {
            // The shielded note starts with exactly one retained source: the
            // depositIndex entering the protocol at e_shield.
            srcIds[i] <== depositIndex;
            enterEpochs[i] <== e_shield;
        } else {
            srcIds[i] <== 0;
            enterEpochs[i] <== 0;
        }
    }

    component slotsRoot = SlotsRoot(K);
    for (var i = 0; i < K; i++) {
        slotsRoot.srcIds[i] <== srcIds[i];
        slotsRoot.enterEpochs[i] <== enterEpochs[i];
    }

    component note = NoteCommit();
    note.amount <== amount;
    note.ownerCommit <== ownerCommit.out;
    // Option C v1 sets rho = depositSecret for notes created from deposits.
    note.rho <== depositSecret;
    note.sourcesRoot <== slotsRoot.root;
    note.out === noteCommit;
}

// The default PoC instantiation uses depth-4 binary trees, so each tree has
// 16 leaf positions at this fixed parameter setting.
component main {public [root_dep, root_blk, e_shield, noteCommit]} = ShieldASP(4, 4, 16);
