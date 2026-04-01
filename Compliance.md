### Minimal formal design

The minimal Compliance ZK-Proof is defined as a privacy preserving exclusion proof over source lineage.

#### Objective

Given a note `n`, a compliance epoch `e`, and a verifier policy `P`, the prover should be able to convince a verifier that the funds represented by `n` do not descend from any source currently contained in a blacklisted set, without revealing the underlying source identifiers or the full transaction graph.

#### Domains and commitments

Let:

* `S` be the universe of source identifiers
* `B_e subseteq S` be the blacklist set at compliance epoch `e`
* `R_e = CommitSet(B_e)` be a commitment to `B_e`
* `L(n) = [s_1, ..., s_k]` be the bounded source-lineage multiset associated with note `n`
* `C_lin(n) = CommitLineage(L(n))` be the lineage commitment stored with, or derivable from, note `n`

`CommitSet` is any authenticated-set commitment that supports zero-knowledge non-membership proofs. `CommitLineage` is any binding commitment to a bounded lineage multiset. The concrete proving system and data structure are intentionally left abstract at this layer.

#### State transition rules

The minimal design only requires source lineage rather than full lineage.

For a mint or onramp event with source identifier `s`, the created note `n` satisfies:

`L(n) = [s]`

For a transfer consuming notes `n_1, ..., n_m` and creating outputs `o_1, ..., o_r`, each output note inherits the union of the input source lineages:

`L(o_j) = Normalize(L(n_1) union ... union L(n_m))` for all `j in {1, ..., r}`

where `Normalize` is a deterministic canonicalization rule and the resulting lineage is required to satisfy `|L(o_j)| <= K_max`, for some policy-defined bound `K_max`.

#### Compliance statement

A compliance proof is defined with public input:

`x = (obj, root_rollup, R_e, H(P), e)`

where:

* `obj` is the public object the proof is bound to, such as a note commitment, nullifier, burn intent, or withdrawal identifier
* `root_rollup` is the relevant rollup state root, when note existence or spend authority must be bound to on-chain state
* `R_e` is the blacklist commitment for epoch `e`
* `H(P)` is a commitment to the verifier policy

The prover supplies a witness:

`w = (note_opening, ownership_secret, L(n), w_state, w_lin, w_1^nm, ..., w_k^nm)`

such that the relation `R_comp(x, w) = 1` holds iff all of the following conditions are satisfied:

1. `note_opening` is a valid opening for the note bound to `obj`
2. `ownership_secret` proves control over the note or over the authorized spend path for the note
3. `w_state` proves that the note is consistent with `root_rollup`, whenever state binding is required
4. `w_lin` proves that `C_lin(n)` opens to `L(n)`
5. `|L(n)| <= K_max`
6. For every `s_i in L(n)`, `VerifyNonMembership(R_e, s_i, w_i^nm) = 1`
7. `Policy(P, note_opening, L(n), e) = 1`

Condition (6) is the core compliance condition: every source represented in the bounded source lineage of the note must be absent from the blacklist committed by `R_e`.

#### Minimal policy interface

The minimal policy function `Policy(P, ...)` should be restricted to constraints that can be evaluated locally by the verifier or encoded into the proof statement. At minimum, `P` should bind:

* the compliance epoch or validity window
* the maximum lineage size `K_max`
* the asset or pool scope, if compliance is enforced per asset
* the action type, such as withdraw, off-ramp, or transfer-to-regulated-counterparty

This binding prevents a proof generated for one verifier policy or one epoch from being replayed under a different policy context.

#### Security goals

The minimal Compliance ZK-Proof is expected to satisfy the following properties:

* **Completeness**: an honest prover with a valid note and valid non-membership witnesses for all source identifiers can produce a proof accepted by the verifier
* **Soundness**: no efficient prover can produce a valid proof for a note whose source lineage contains an identifier in `B_e`
* **Zero-knowledge**: the verifier learns no source identifiers, no hidden transaction graph, and no additional note data beyond what is explicitly exposed in `x`
* **Policy binding**: a proof valid for policy `P` is not reusable for a different policy `P'`

#### Scope of the minimal design

This minimal design deliberately proves only exclusion from a blacklisted source set. It does not, by itself, prove broader claims such as:

* that the source belongs to an approved whitelist
* that the source originates from a specific jurisdiction
* that the user passed KYC with a particular provider
* that the entire intermediate transaction graph is compliant

Those properties can be introduced later as additional predicates inside `Policy(P, ...)` or as separate attestations that are recursively or jointly proved with the compliance statement above.

### Improved designs for scalable compliance

The minimal design above is intentionally simple, but it does not scale well if `L(n)` is interpreted as an exact and ever-growing source-lineage multiset. In particular, arbitrary merge and split operations cause witness size, proof cost, and off-chain lineage retention requirements to grow with transaction history. Two practical improvement paths are outlined below.

#### Option A: bounded K-window lineage

The first improvement is to replace exact lineage with a bounded compliance window.

Instead of storing or proving over the full source-lineage multiset, each note `n` carries:

`W_K(n) = Window_K(E(n))`

where `E(n)` is the ordered sequence of compliance-relevant lineage events for `n`, and `Window_K` keeps only the most recent `K` items under a deterministic ordering rule.

The note then carries a commitment:

`C_win(n) = CommitWindow(W_K(n))`

State transitions are defined as follows:

* For a mint or onramp event with source identifier `s`, `W_K(n) = [s]`
* For a transfer consuming `n_1, ..., n_m` and producing `o_1, ..., o_r`, each output satisfies:

`W_K(o_j) = Window_K(MergeEvents(W_K(n_1), ..., W_K(n_m)))`

The corresponding compliance statement is changed from full-lineage exclusion to bounded-window exclusion. The prover shows that all identifiers retained in `W_K(n)` are absent from the blacklist commitment `R_e`.

This construction has the following properties:

* the note state remains bounded
* the witness size remains bounded by `K`
* the proof cost remains bounded by `K`
* the verifier can continue to use a simple non-membership relation

However, the semantics are materially weaker. The proof no longer states that the note is free of blacklisted ancestry in the full historical sense. It states only that no blacklisted identifier appears in the retained compliance window. As a result:

* a blacklisted source can age out of the window after sufficient transfer depth
* merge-heavy activity can push older sources out of the retained set
* retroactive blacklisting becomes invisible once a source has left the window
* the construction should be treated as a bounded-horizon risk control, not as a full provenance proof

This option is appropriate when the policy objective is explicitly local in time or depth, for example "no blacklisted source within the last `K` compliance-relevant events" or "no blacklisted source within the last `T` epochs", but it should not be presented as a proof of full historical cleanliness.

#### Option B: recursive compliance certificate

The second improvement is to replace raw lineage retention with a recursive compliance certificate.

In this design, each note `n` carries a constant-size certificate commitment:

`C_cert(n) = CommitCert(cert(n))`

where `cert(n)` is not the full lineage itself, but a recursively generated proof object attesting that `n` descends only from inputs that satisfied a prior compliance predicate.

The construction is defined inductively.

For a mint or onramp event with source identifier `s`, the system generates a base certificate `cert_0` proving:

* the mint corresponds to source `s`
* `s` satisfies the source compliance predicate under policy `P_0`
* the resulting note commitment is correctly formed

For a transfer consuming notes `n_1, ..., n_m` and producing outputs `o_1, ..., o_r`, the prover generates a step certificate `cert_step` proving:

* each input note is valid and spendable
* each input note carries a valid prior certificate
* the transfer relation from inputs to outputs is valid
* the output note commitments are correctly formed
* the compliance policy transition from the input certificates to the output certificates is valid

Each output note then carries a new certificate `cert(o_j)` derived from the step proof. The note state remains constant-size because only the newest certificate, or a commitment to it, is carried forward.

At withdraw or off-ramp time, the prover presents a final proof showing:

* the note is valid and controlled by the prover
* the note carries a valid recursive compliance certificate
* the certificate is acceptable under the verifier policy `P_final`

This construction has the following advantages:

* note state remains constant-size
* raw source lineage does not need to be retained on-chain
* unbounded transfer depth becomes possible without unbounded proof inputs
* the compliance relation can be aggregated or recursively folded over time

The main trade-off is semantic and operational complexity. A recursive certificate only works if the compliance predicate is carefully defined across time. In particular, the system must decide whether a certificate means:

* the source set was compliant at each historical step, or
* the note is compliant with respect to a current blacklist at verification time

Those are not equivalent when blacklist membership can change over time. Accordingly, a recursive certificate design should usually be paired with one of the following policy models:

* an append-only blacklist with explicit epoch binding
* a bounded validity window after which a fresh certificate is required
* a regulated checkpoint model in which a trusted boundary reissues a new certificate under the latest compliance root

This option is the stronger long-term architecture if the system wants to support arbitrary transfer depth while preserving compact note state, but it requires a recursive proving stack and a much more precise definition of certificate semantics.

#### Option C: time-bounded POI retention with retained-slot strict verification

The third improvement is to prune proof-of-innocence data with a time rule while keeping verification strict over every source that is still retained in the note state.

This construction is different from a bounded `K`-window. The retention rule is anchored to the protocol-entry time of each source, not to transfer depth, note age, or the most recent `K` observed lineage items.

Let each protocol-entry source `s` carry an entry timestamp or entry epoch:

`tau(s) = entry_time(s)`

Define a pruning operator evaluated at transfer time `t`:

`Prune_T(U, t) = { s in U : t - tau(s) <= T }`

Each note `n` carries a retained compliance source set `R_T(n)` fixed when the note is created:

* For a mint or onramp event with source identifier `s` at time `t`, the created note satisfies:

`R_T(n) = {s}`

* For a transfer consuming `n_1, ..., n_m` and producing `o_1, ..., o_r` at time `t`, each output satisfies:

`R_T(o_j) = Prune_T(R_T(n_1) union ... union R_T(n_m), t)`

The note carries a commitment to that retained set, or to a data structure from which it can be derived:

`C_ret(n) = CommitRetained(R_T(n))`

The compliance statement is then:

> Every protocol-entry source currently retained in the note state is absent from the blacklist committed by the current compliance root.

Equivalently, the prover shows that for all `s in R_T(n)`:

`VerifyNonMembership(R_e, s, w_s^nm) = 1`

Unlike a pure active-window check, a source whose current age already exceeds `T` can still remain compliance-relevant if it is still retained in the note state. It stops affecting future proofs only after a successful transfer prunes it out of descendant notes.

This construction has the following advantages:

* it prevents indefinite backward contamination while still pruning state at transfer time
* it avoids the semantic weakness of a "most recent `K` items" rule
* it gives a policy-natural interpretation in which pruning is an explicit state-transition rule rather than a verification-time exemption
* it preserves the property that a source blacklisted after aging beyond `T` still blocks spends of notes that continue to retain it

The soundness statement becomes retention-bounded rather than fully historical:

* **retained-slot soundness**: no efficient prover can produce a valid POI for a note if any protocol-entry source currently retained in that note is blacklisted in the current compliance root

The completeness statement is likewise retention-bounded:

* **retained-slot completeness**: an honest prover can produce a valid POI whenever all protocol-entry sources currently retained in the note remain non-blacklisted

This model has an important policy consequence. If a source ages beyond `T` but is still present in an existing note, later blacklisting still blocks POI generation for that note. The source stops affecting future POI generation only after a successful transfer prunes it out of the retained note state. This is a deliberate policy choice: `T` controls which sources are copied forward into newly created notes, not which already-retained slots are exempt from blacklist checking.

To avoid replay or stale-proof issues, this option should be paired with:

* a current blacklist root or compliance epoch in the public inputs
* short-lived proof validity or per-spend proof generation
* a clear definition of protocol-entry time and its canonical encoding

The main remaining limitation is fan-in. Even with time-bounded retention, a note can still accumulate many retained sources that are simultaneously inside the `T`-day pruning window at a transfer boundary. Accordingly, this option is often best combined with one of the following:

* periodic checkpointing or source consolidation
* bucketed or epoch-level aggregation of retained sources
* recursive certificate compression as in Option B
