pragma circom 2.1.6;

include "./lib/utils.circom";
include "./lib/commitments.circom";
include "./lib/binary_merkle.circom";
include "./lib/indexed_blacklist.circom";
include "./lib/slots.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// UnshieldPOI proves that a retained-source note can be withdrawn publicly.
//
// D_NOTE is the binary note-tree depth, so the withdrawal witness contains a
// path of exactly D_NOTE siblings and D_NOTE direction bits.
// D_BLK is the indexed blacklist tree depth.
//
// Under retained-slot strict semantics, every retained source slot still stored
// in the note must pass blacklist non-membership at e_now. A source older than
// T does not become exempt merely because it is no longer active; it stops
// mattering only after a successful transfer prunes it from the note state.

template UnshieldPOI(D_NOTE, D_BLK, K) {
    // Public note Merkle root containing the note being withdrawn.
    signal input root_note;
    // Public blacklist root at the withdrawal epoch.
    signal input root_blk;
    // Epoch at which the withdrawal is evaluated.
    signal input e_now;
    // Public nullifier of the withdrawn note.
    signal input nf;
    // Public withdrawal commitment bound to amount, recipient, and nullifier.
    signal input withdrawCommit;

    // Amount stored in the note being withdrawn.
    signal input amount;
    // rho value of the note being withdrawn.
    signal input rho;
    // ask witness authorizing the withdrawal.
    signal input ask;
    // Public recipient encoded as a field element.
    signal input recipient;
    // Retained source ids currently stored in the note.
    signal input srcIds[K];
    // Entry epochs paired with the retained source ids.
    signal input enterEpochs[K];
    // Merkle sibling path proving note inclusion in root_note.
    signal input notePathSiblings[D_NOTE];
    // Path direction bits for the note inclusion proof.
    signal input notePathIndices[D_NOTE];

    // Lower predecessor endpoints for each retained-slot blacklist witness.
    signal input nmLowLeafKey[K];
    // Upper predecessor endpoints for each retained-slot blacklist witness.
    signal input nmLowLeafNextKey[K];
    // Merkle sibling paths for each retained-slot blacklist witness.
    signal input nmPathSiblings[K][D_BLK];
    // Path direction bits for each retained-slot blacklist witness.
    signal input nmPathIndices[K][D_BLK];

    component epochLessEq[K];
    component epochCheck[K];
    component nm[K];

    component amountRange = RangeCheck(128);
    amountRange.in <== amount;

    component rhoRange = RangeCheck(64);
    rhoRange.in <== rho;

    component askRange = RangeCheck(64);
    askRange.in <== ask;

    component eNowRange = RangeCheck(64);
    eNowRange.in <== e_now;

    component slotState = WellFormedSlots(K);
    for (var i = 0; i < K; i++) {
        slotState.srcIds[i] <== srcIds[i];
        slotState.enterEpochs[i] <== enterEpochs[i];
    }

    for (var i = 0; i < K; i++) {
        // A retained source cannot claim to enter after the withdrawal epoch.
        epochLessEq[i] = LessEqThan(64);
        epochLessEq[i].in[0] <== enterEpochs[i];
        epochLessEq[i].in[1] <== e_now;

        epochCheck[i] = ForceEqualIfEnabled();
        epochCheck[i].enabled <== slotState.isRetained[i];
        epochCheck[i].in[0] <== epochLessEq[i].out;
        epochCheck[i].in[1] <== 1;

        // Every retained source still present in the note must be clean.
        nm[i] = IndexedBlacklistNonMembership(D_BLK);
        nm[i].enabled <== slotState.isRetained[i];
        nm[i].root <== root_blk;
        nm[i].srcId <== srcIds[i];
        nm[i].lowLeafKey <== nmLowLeafKey[i];
        nm[i].lowLeafNextKey <== nmLowLeafNextKey[i];
        for (var d = 0; d < D_BLK; d++) {
            nm[i].siblings[d] <== nmPathSiblings[i][d];
            nm[i].pathIndices[d] <== nmPathIndices[i][d];
        }
    }

    component slotsRoot = SlotsRoot(K);
    for (var i = 0; i < K; i++) {
        slotsRoot.srcIds[i] <== srcIds[i];
        slotsRoot.enterEpochs[i] <== enterEpochs[i];
    }

    component ownerCommit = OwnerCommit();
    ownerCommit.ask <== ask;

    component note = NoteCommit();
    note.amount <== amount;
    note.ownerCommit <== ownerCommit.out;
    note.rho <== rho;
    note.sourcesRoot <== slotsRoot.root;

    component noteProof = BinaryMerkleProof(D_NOTE);
    noteProof.leaf <== note.out;
    for (var d = 0; d < D_NOTE; d++) {
        noteProof.siblings[d] <== notePathSiblings[d];
        noteProof.pathIndices[d] <== notePathIndices[d];
    }
    noteProof.root === root_note;

    component nfCalc = Nullifier();
    nfCalc.ask <== ask;
    nfCalc.rho <== rho;
    nfCalc.out === nf;

    component withdraw = WithdrawCommit();
    withdraw.amount <== amount;
    withdraw.recipient <== recipient;
    withdraw.nf <== nf;
    withdraw.out === withdrawCommit;
}

// The default PoC instantiation uses depth-4 binary trees.
component main {public [root_note, root_blk, e_now, nf, withdrawCommit]} = UnshieldPOI(4, 4, 16);
