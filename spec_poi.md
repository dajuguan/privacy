我们来实现一个Option C: time-bounded POI retention的合规电路吧，用circom实现，放到circuits目录
合约采用deposit => shield => shield_transfer* => unshield的方式，以保证shield的时候可以证明ASP，否则ASP需要保存公链上所有的数据
1. 首先是ASP的电路：需要证明shield的index不在blacklist里，这个可以参考https://github.com/ameensol/privacy-pools/tree/main/circuits
2. 其次是POI(采用./Compliance.md中Option C: time-bounded POI retention)的方式


## 电路形式化定义

### 1. 范围

当前版本覆盖 `deposit => shield => shield_transfer* => unshield` 这条流程，其中 `shield_transfer*` 表示零次或多次私有转账。

1. `ShieldASP`：用户把公开 `deposit` 转成私有 note 时，证明该 `depositIndex` 在当前 ASP blacklist 中为非成员，同时生成携带 POI 元数据的 note。
2. `shield_transfer`：支持多输入、多输出的私有转账。证明输入 notes 存在、自己拥有这些 notes、输入输出金额守恒，并且所有输出 notes 都正确继承输入 notes 合并后的 source 信息。
3. `UnshieldPOI`：用户把私有 note 提现回公开地址时，证明该 note 当前仍保留在 slots 中的所有 protocol-entry source 都不在当前 blacklist 中。

这里采用 `./Compliance.md` 中的 Option C: time-bounded POI retention with retained-slot strict verification。也就是说，`T` 只决定哪些 source 会被复制到新创建的 note 中；但对于某个当前 note 里仍然保留着的 source slot，无论它是否已经超过 `T` 个 epoch，只要它还没被 prune 掉，在 `shield_transfer` 或 `unshield` 时都必须证明其不在 blacklist 中。

为了支持多输入、多输出的 `shield_transfer`，每个 note 不再只绑定一个 source，而是绑定一个固定长度为 `K` 的 source 数组。数组不足 `K` 时使用 padding 补齐。

当前版本显式引入：

* 固定长度 `K` 的 source slot 数组
* padding slot
* `Canon_e` / `SortBySrcId` / `UniqueBySrcId`
* 多输入 merge
* 多输出 split / change note

当前版本仍然不引入更复杂的递归压缩；如果按当前 transfer epoch 过滤后的活跃 source 数超过 `K`，电路直接拒绝。

### 2. 全局参数与基本对象

设：

* `H` 为电路内统一使用的哈希函数，具体实现取 `Poseidon`

> **实现备注**：使用 `circomlib` 的 `Poseidon(n)` 模板，不同 arity 分别实例化（如 `Poseidon(1)`、`Poseidon(2)`、`Poseidon(3)`、`Poseidon(4)`）。
* `T` 为 source 保留窗口，对应“最多保留 `T` 个 epoch”
* `K` 为每个 note 最多保留的 source 数量
* `MAX_INPUTS` 为单次 `shield_transfer` 电路支持的最大输入 note 数
* `MAX_OUTPUTS` 为单次 `shield_transfer` 电路支持的最大输出 note 数
* `D_dep` 为公开 `deposit` Merkle tree 深度
* `D_note` 为私有 note commitment tree 深度
* `root_dep` 为公开 `deposit` Merkle tree 的 root
* `root_note` 为私有 note commitment tree 的 root
* `R_blk[e]` 为合规 epoch `e` 下 blacklist 的 commitment root
* `D_blk` 为 blacklist indexed Merkle tree 深度

对 `circom` 来说，`K`、`MAX_INPUTS`、`MAX_OUTPUTS` 都应视为编译期常量或模板参数。第一版实现可以直接固定成一个具体实例，例如 `K = 16`、`MAX_INPUTS = 2`、`MAX_OUTPUTS = 2`。

各字段的比特宽度约定如下：

* `amount`：128 bits
* `depositIndex` / `srcId`：64 bits
* `enterEpoch` / `e_shield` / `e_tx` / `e_now`：64 bits
* `T`：64 bits
* `ask` / `rho` / `depositSecret`：64 bits

> **实现备注**：`circom` 中所有涉及大小比较的约束（如 `enterEpoch <= e_tx`、`e_tx - enterEpoch <= T`）都需要使用 `circomlib` 的 `LessThan(n)` / `LessEqThan(n)` 组件，并传入对应的比特宽度参数 `n`。

当前系统中的 protocol-entry source 定义为一次成功 `shield` 的公开来源：

* `srcId := depositIndex`
* `enterEpoch := e_shield`

也就是说，source 的“进入协议时间”按 `shield` 被接受的 epoch 计算，而不是按用户更早发起公开 `deposit` 的时间计算。

约定 `depositIndex > 0`，因此 `srcId = 0` 被保留为 padding sentinel。

### 3. 承诺结构

当前先假设系统里只有一个 pool 和一种 asset，因此 `poolId`、`assetId` 暂不进入电路输入和承诺。

#### 3.1 Deposit leaf

公开入金 leaf 记为：

`dep = (depositIndex, amount, ownerCommit, depositSecret)`

其中：

* `depositIndex` 是公开且唯一的入金索引
* `ownerCommit = H(ask)`，`ask` 是私有花费密钥
* `depositSecret` 是 shield 时要绑定到 note 的随机量

其叶子承诺为：

`depLeaf = H(depositIndex, amount, ownerCommit, depositSecret)`

`root_dep` 不是简单地把所有 `depLeaf` 再做一次总哈希，而是公开 `deposit` append-only Merkle tree 的 root。

具体约定如下：

* 合约为每一笔公开 `deposit` 分配严格递增的 `depositIndex`
* Merkle tree 的叶子位置采用 `leafPos = depositIndex - 1`
* 第 `leafPos` 个叶子存放该笔 `deposit` 的 `depLeaf`
* 未使用的叶子位置填充固定的空叶子值 `EMPTY_DEP_LEAF`

因此，`root_dep` 的顺序由 `depositIndex` 唯一决定，不存在“hash 所有 `depLeaf` 时如何排序”的额外自由度。

`depositIndex` 的一次性消费由合约侧状态负责约束，电路只负责证明该 leaf 的存在和字段一致性。

#### 3.2 Source slots

每个 note 维护一个固定长度数组：

`Slots(note) = [slot_0, ..., slot_{K-1}]`

其中：

`slot_i = (srcId_i, enterEpoch_i)`

约定：

* padding slot 定义为 `(0, 0)`
* `srcId_i = 0` 表示该 slot 为 padding
* 若 `srcId_i = 0`，则必须有 `enterEpoch_i = 0`
* 所有非 padding slot 必须出现在所有 padding slot 之前
* 所有非 padding slot 按 `srcId` 严格递增

称满足上述约束的数组为 `WellFormed(Slots(note))`。

定义：

* `RealSlots(S) = { (srcId_i, enterEpoch_i) | srcId_i != 0 }`
* `Pad_K([u_0, ..., u_{q-1}]) = [u_0, ..., u_{q-1}, (0,0), ..., (0,0)]`，其中 `q <= K`

每个 source slot 的叶子承诺为：

`srcLeaf_i = H(srcId_i, enterEpoch_i)`

整个 source 数组的根为：

`sourcesRoot = MerkleRoot(srcLeaf_0, ..., srcLeaf_{K-1})`

#### 3.3 Private note

私有 note 的 opening 定义为：

`note = (amount, ownerCommit, rho, sourcesRoot)`

对应承诺：

`noteCommit = H(amount, ownerCommit, rho, sourcesRoot)`

nullifier 定义为：

`nf = H(ask, rho)`

这样在 `unshield` 时，证明者只需证明自己知道 `ask`，且 note 中的 `ownerCommit = H(ask)`，就可以在不暴露身份的前提下生成唯一 nullifier。

#### 3.4 Non-membership witness 结构

blacklist 使用有序 indexed Merkle tree。每个叶子存储 `(key, nextKey)`，其中 `key` 为已被 blacklist 的 `srcId`，`nextKey` 为排序后的下一个 key（最后一个叶子的 `nextKey` 定义为一个足够大的 sentinel 值，例如 `2^64 - 1`）。

对于某个待证明不在 blacklist 中的 `srcId`，non-membership witness 定义为：

`w_nm = (lowLeafKey, lowLeafNextKey, path_low)`

其中：

* `lowLeafKey` 是 blacklist 中严格小于 `srcId` 的最大 key（即 `lowLeafKey < srcId`）
* `lowLeafNextKey` 是该叶子记录的下一个 key（即 `srcId < lowLeafNextKey`）
* `path_low` 是 `H(lowLeafKey, lowLeafNextKey)` 到 `R_blk[e]` 的 Merkle inclusion path，长度为 `D_blk`

`VerifyNonMembership(R_blk[e], srcId, w_nm) = 1` 当且仅当：

1. `lowLeafKey < srcId`
2. `srcId < lowLeafNextKey`
3. `path_low` 验证通过，即 `H(lowLeafKey, lowLeafNextKey)` 确实属于 `R_blk[e]`

> **实现备注**：比较操作使用 `circomlib` 的 `LessThan(64)` 组件（因为 `srcId` 为 64 bits）。

#### 3.4.1 备选方案：Sparse Merkle Tree (SMT)

如果希望简化电路逻辑和链上插入成本，可以用 Sparse Merkle Tree 替代 indexed Merkle tree。

SMT 的树深度固定为 key 的比特宽度（`srcId` 为 64 bits → 深度 64）。每个 `srcId` 对应树中一个固定位置，被 blacklist 的 `srcId` 对应的叶子存储非零值，未被 blacklist 的位置为默认空值 `EMPTY_LEAF = 0`。

在 SMT 方案下，non-membership witness 简化为：

`w_nm = (path_smt)`

其中 `path_smt` 是长度为 64 的 Merkle siblings 数组。

`VerifyNonMembership(R_blk[e], srcId, w_nm) = 1` 当且仅当：

1. 从 `path_smt` 和 `srcId`（作为叶子位置）重算的叶子值为 `EMPTY_LEAF = 0`
2. 从该叶子和 `path_smt` 重算的 root 等于 `R_blk[e]`

与 indexed Merkle tree 的对比：

| | Indexed Merkle Tree | Sparse Merkle Tree |
|---|---|---|
| 非成员证明 | 需找前驱节点 + `LessThan` 比较 | 普通 Merkle inclusion + `IsZero` |
| 插入 | 2 次 path 更新 | 1 次 path 更新 |
| 树深度 | `D_blk`（按实际叶子数，通常 20-32） | 固定 64 |
| 电路 hash 次数 | 较少（树浅） | 较多（树深 64） |
| 电路额外组件 | 2 × `LessThan(64)` | 1 × `IsZero` |
| witness 大小 | `lowLeafKey` + `lowLeafNextKey` + path | 仅 path |

两种方案的 `VerifyNonMembership` 接口一致，选择哪种不影响其余电路定义。

### 4. Option C 的状态语义

对一笔在 epoch `e` 执行的 transfer，定义原始输入 source 列表 `U_raw` 的输出保留过滤：

`Active_e(U_raw) = { (s, tau) in U_raw | tau <= e, e - tau <= T }`

定义一致性条件：

`Consistent(U_raw) = 1` 当且仅当对任意 `(s, tau_1), (s, tau_2) in U_raw`，都有 `tau_1 = tau_2`

定义：

* `UniqueBySrcId(U)`：在 `Consistent(U) = 1` 的前提下，按 `srcId` 去重
* `SortBySrcId(U)`：按 `srcId` 升序排列
* `Canon_e(U_raw) = Pad_K(SortBySrcId(UniqueBySrcId(Active_e(U_raw))))`

若 `|UniqueBySrcId(Active_e(U_raw))| > K`，则 `Canon_e(U_raw)` 未定义，电路直接拒绝。

这意味着：

1. source 一旦进入协议，就携带其 `enterEpoch`。
2. 多输入转账时，所有输入 notes 的 source 会先按 concat 方式收集，再去重、过滤掉超过 `T` 个 epoch 的旧 source，最后补齐到 `K` 个 slot，作为新输出 notes 的 retained source 数组。
3. 同一次 `shield_transfer` 创建的所有输出 notes 都继承同一个 canonical source 数组。
4. 在 `shield_transfer` 和 `unshield` 时，blacklist 检查作用于当前 note 中所有仍被保留的非 padding source slots，而不只作用于 `Active_e(U_raw)`。
5. 因此，一个 source 即使已经超过 `T` 个 epoch，只要它仍保留在当前 note 中且尚未被后续成功 transfer prune 掉，就依然可以阻止该 note 继续 `shield_transfer` 或 `unshield`。

这里的 `Canon_e(U_raw)` 主要是语义定义，不要求电路内部真的执行一个通用的 `sort + unique` 算法。

这里特意不按 `enterEpoch` 作为主排序键。原因是：

* `enterEpoch` 不是唯一值，多个 source 完全可能在同一个 epoch 进入协议，因此无法要求它“严格递增”
* retained-slot strict 的语义是“新输出只保留仍活跃的 source，但当前 note 已保留的 source 都要接受检查”，而不是“优先保留最新的 source”
* 如果在 source 数超过 `K` 时按 `enterEpoch` 只保留较新的那些 source，那么语义会从 Option C 退化成一种按新旧裁剪的混合模型

因此当前版本中，`enterEpoch` 只用于判断 source 在 transfer 时是否仍应被复制到新输出里，不用于决定 overflow 时该保留谁，也不用于豁免当前已保留 slots 的 blacklist 检查；若活跃 source 数超过 `K`，proof 直接失败。

更适合 `circom` 的实现方式是：

* prover 在电路外先计算好候选输出数组 `Slots_out`
* 电路只验证 `Slots_out` 的确等于 `Canon_e(U_raw)`，而不是在约束系统里显式执行排序算法

也就是说，实现层更推荐把它写成一个关系：

`MergeToCanonical(e, U_raw, Slots_out) = 1`

而不是一个“电路内构造函数”。

### 5. `ShieldASP` 电路关系

`ShieldASP` 的公共输入定义为：

`x_shield = (root_dep, R_blk[e_shield], e_shield, noteCommit)`

私有 witness 定义为：

`w_shield = (dep, path_dep, w_nm, ask, rho)`

其中：

* `path_dep` 是 `depLeaf` 到 `root_dep` 的 Merkle inclusion path
* `w_nm` 是 `depositIndex` 相对 `R_blk[e_shield]` 的 non-membership witness
* `rho` 可以直接取 `depositSecret`，也可以由 `depositSecret` 再派生；两者只需在实现时固定一种方式

> **PoC 实现备注**：第一版 PoC 直接取 `rho = depositSecret`，不做额外派生。

关系 `R_shield(x_shield, w_shield) = 1` 当且仅当以下条件同时成立：

1. `ownerCommit = H(ask)`。
2. `depLeaf = H(depositIndex, amount, ownerCommit, depositSecret)`。
3. `path_dep` 验证通过，即 `depLeaf` 确实属于 `root_dep`。
4. `VerifyNonMembership(R_blk[e_shield], depositIndex, w_nm) = 1`。
5. 输出 note 的 source 数组满足：

   `Slots(note) = Pad_K([(depositIndex, e_shield)])`

6. `sourcesRoot = MerkleRoot(srcLeaf_0, ..., srcLeaf_{K-1})`，其中 `srcLeaf_0 = H(depositIndex, e_shield)`，对所有 `i >= 1` 都有 `srcLeaf_i = H(0, 0)`。
7. `noteCommit = H(amount, ownerCommit, rho, sourcesRoot)`。

该关系表达的语义是：只有当某个公开 `deposit` 在 shield 时刻不在 blacklist 中时，才允许它作为新的 protocol-entry source 进入隐私池。

### 6. `shield_transfer` 电路关系

`shield_transfer` 的 `circom` 版本建议直接定义为固定上界关系：最多消耗 `MAX_INPUTS` 个输入 notes，最多创建 `MAX_OUTPUTS` 个输出 notes，并用 selector bits 标记本次交易实际使用了哪些输入和输出。

其公共输入定义为：

`x_transfer = (root_note, R_blk[e_tx], e_tx, inUsed_0, ..., inUsed_{MAX_INPUTS-1}, outUsed_0, ..., outUsed_{MAX_OUTPUTS-1}, nf_0, ..., nf_{MAX_INPUTS-1}, noteCommit_out_0, ..., noteCommit_out_{MAX_OUTPUTS-1})`

私有 witness 定义为：

`w_transfer = (note_in_0, ..., note_in_{MAX_INPUTS-1}, Slots_0, ..., Slots_{MAX_INPUTS-1}, path_0, ..., path_{MAX_INPUTS-1}, ask_0, ..., ask_{MAX_INPUTS-1}, amount_out_0, ..., amount_out_{MAX_OUTPUTS-1}, ownerCommit_out_0, ..., ownerCommit_out_{MAX_OUTPUTS-1}, rho_out_0, ..., rho_out_{MAX_OUTPUTS-1}, sel_{i,j,k}, w_nm_{i,j})`

其中：

* `inUsed_i in {0, 1}` 表示第 `i` 个输入是否被本次交易实际使用
* `outUsed_j in {0, 1}` 表示第 `j` 个输出是否被本次交易实际使用
* `Slots_i` 是第 `i` 个输入 note 对应的固定长度 source 数组
* `path_i` 是输入 `noteCommit_i` 到 `root_note` 的 Merkle inclusion path
* `ownerCommit_out_j` 是第 `j` 个接收方公钥承诺，不要求发送方知道接收方私钥
* `sel_{i,j,k} in {0, 1}` 是匹配 selector，表示输入 note `i` 的第 `j` 个 source slot 是否映射到 canonical 输出数组的第 `k` 个 slot
* `w_nm_{i,j}` 只在第 `i` 个输入 note 的第 `j` 个 source slot 为真实 source 时参与约束

关系 `R_transfer(x_transfer, w_transfer) = 1` 当且仅当以下条件同时成立：

1. 所有 `inUsed_i`、`outUsed_j`、`sel_{i,j,k}` 都必须是布尔量。

1a. 至少有一个输入和一个输出被实际使用：

   `sum_{i=0}^{MAX_INPUTS-1} inUsed_i >= 1`
   `sum_{j=0}^{MAX_OUTPUTS-1} outUsed_j >= 1`

2. 对每个输入 `i in {0, ..., MAX_INPUTS-1}`：

   * 若 `inUsed_i = 1`，则：
     `ownerCommit_i = H(ask_i)`
     `noteCommit_i = H(amount_in_i, ownerCommit_i, rho_in_i, sourcesRoot_i)`
     `path_i` 验证通过，即 `noteCommit_i` 确实属于 `root_note`
     `nf_i = H(ask_i, rho_in_i)`
     `sourcesRoot_i = MerkleRoot(srcLeaf_{i,0}, ..., srcLeaf_{i,K-1})`，其中 `srcLeaf_{i,j} = H(srcId_{i,j}, enterEpoch_{i,j})`
     `Slots_i` 满足 `WellFormed`
     对 `Slots_i` 中每个非 padding source `(srcId, enterEpoch)`，都要求 `enterEpoch <= e_tx`

   * 若 `inUsed_i = 0`，则：
     `note_in_i = 0`
     `amount_in_i = 0`
     `ownerCommit_i = 0`
     `ask_i = 0`
     `rho_in_i = 0`
     `sourcesRoot_i = MerkleRoot(H(0,0), ..., H(0,0))`
     `nf_i = 0`
     `Slots_i = Pad_K([])`
     该输入的 Merkle path 不参与语义约束

   > **合约侧备注**：当 `inUsed_i = 0` 时 `nf_i = 0`，合约在处理公共输入时必须跳过值为 0 的 nullifier，不得将其加入 nullifier set。同理，`outUsed_j = 0` 时 `noteCommit_out_j = 0`，合约不得将其插入 note commitment tree。

3. 对每个输入 source slot `(i, j)`，定义其是否为活跃真实 source：

   `live_{i,j} = inUsed_i AND (srcId_{i,j} != 0) AND (e_tx - enterEpoch_{i,j} <= T)`

   > **边界情况说明**：当 `inUsed_i = 0` 时，所有 `Slots_i` 为 padding（`srcId = 0`），因此 `srcId_{i,j} != 0` 为 false，`live_{i,j}` 必然为 0，无需单独处理。即使 `e_tx <= T` 导致 `e_tx - 0 <= T` 为 true，由于 AND 运算的短路效果，结果仍然是 0。

4. 定义输入 source 的原始拼接列表：

   `U_raw = Concat(RealSlots(Slots_0), ..., RealSlots(Slots_{MAX_INPUTS-1}))`

   在固定上界实现里，`U_raw` 对应所有被当前输入 notes 实际保留的真实 slots；其中只有满足 `live_{i,j} = 1` 的 slots 会被复制到 `Slots_out`，但所有真实输入 slots 都继续参与当前 blacklist 检查。

5. 定义所有输出 notes 共享的 canonical source 数组：

   `MergeToCanonical(e_tx, U_raw, Slots_out) = 1`

   其中 `MergeToCanonical(e_tx, U_raw, Slots_out) = 1` 至少要求：

   * `WellFormed(Slots_out)`
   * 对每个输入 slot `(i, j)`，有：
     `sum_{k=0}^{K-1} sel_{i,j,k} = live_{i,j}`
   * 若 `sel_{i,j,k} = 1`，则必须有：
     `srcId_{i,j} = srcId_out_k`
     `enterEpoch_{i,j} = enterEpoch_out_k`
   * 对每个输出 slot `k`，定义：
     `coverCount_k = sum_{i=0}^{MAX_INPUTS-1} sum_{j=0}^{K-1} sel_{i,j,k}`
   * 若 `srcId_out_k != 0`，则必须有 `coverCount_k >= 1`
   * 若 `srcId_out_k = 0`，则必须有 `coverCount_k = 0`
   * 由于 `Slots_out` 已要求按 `srcId` 严格递增，因此输出中不会出现重复 source
   * 若某个 `srcId` 在多个输入中重复出现，则这些出现必须映射到同一个输出 slot，且 `enterEpoch` 必须一致

   > **说明**：`Consistent(U_raw)` 由 `sel` 映射约束隐式保证——当同一 `srcId` 的多个出现通过 `sel_{i,j,k} = 1` 映射到同一个输出 slot `k` 时，每个出现都被约束为 `enterEpoch_{i,j} = enterEpoch_out_k`，因此它们的 `enterEpoch` 必然一致。无需在电路中单独实现 `Consistent` 检查。

6. 对每个输入 source slot `(i, j)`，若 `inUsed_i = 1` 且 `srcId_{i,j} != 0`，则必须有：

   `VerifyNonMembership(R_blk[e_tx], srcId_{i,j}, w_nm_{i,j}) = 1`

   对 padding slot `(0,0)`，或未使用输入中的 slot，对应的 `w_nm_{i,j}` 不参与语义约束。

7. `sourcesRoot_out` 由 `Slots_out` 计算得到。

8. 金额守恒：

   `amount_in_0 + ... + amount_in_{MAX_INPUTS-1} = amount_out_0 + ... + amount_out_{MAX_OUTPUTS-1}`

   > **实现备注**：所有 `amount_in_i` 和 `amount_out_j` 都需要 range check（128 bits），防止利用素数域 underflow 伪造金额守恒。

9. 对每个输出 `j in {0, ..., MAX_OUTPUTS-1}`：

   * 若 `outUsed_j = 1`，则：
     `noteCommit_out_j = H(amount_out_j, ownerCommit_out_j, rho_out_j, sourcesRoot_out)`

   * 若 `outUsed_j = 0`，则：
     `amount_out_j = 0`
     `ownerCommit_out_j = 0`
     `rho_out_j = 0`
     `noteCommit_out_j = 0`

该关系表达的语义是：`shield_transfer` 会先检查当前输入 notes 中所有仍被保留的真实 source slots 都不在当前 blacklist 中；然后再按当前 epoch 过滤活跃项、去重、排序、补到 `K` 个 slot，并让所有输出 notes 共同继承这份 canonical source 状态。这样一来，某个 source 即使已经超过 `T` 个 epoch，只要它还保留在输入 note 中，就仍然可以阻止本次 transfer。

### 7. `UnshieldPOI` 电路关系

`UnshieldPOI` 的公共输入定义为：

`x_unshield = (root_note, R_blk[e_now], e_now, nf, withdrawCommit)`

私有 witness 定义为：

`w_unshield = (note, Slots(note), path_note, ask, recipient, w_nm_0, ..., w_nm_{K-1})`

其中：

* `path_note` 是 `noteCommit` 到 `root_note` 的 Merkle inclusion path
* `withdrawCommit = H(amount, recipient, nf)`
* `w_nm_k` 只在第 `k` 个 source slot 为真实 source 时才真正参与约束

关系 `R_unshield(x_unshield, w_unshield) = 1` 当且仅当以下条件同时成立：

1. `ownerCommit = H(ask)`。
2. `noteCommit = H(amount, ownerCommit, rho, sourcesRoot)`。
3. `path_note` 验证通过，即 `noteCommit` 确实属于 `root_note`。
4. `sourcesRoot = MerkleRoot(srcLeaf_0, ..., srcLeaf_{K-1})`，其中 `srcLeaf_i = H(srcId_i, enterEpoch_i)`。
5. `Slots(note)` 满足 source slot 的 well-formed 约束。
6. 对 `Slots(note)` 中每个非 padding source `(srcId_i, enterEpoch_i)`，都要求 `enterEpoch_i <= e_now`。
7. `nf = H(ask, rho)`。
8. `withdrawCommit = H(amount, recipient, nf)`。
9. 对每个 `i in {0, ..., K-1}`，定义：

   `isRetained_i = (srcId_i != 0)`

10. 若 `isRetained_i = 1`，则必须有 `VerifyNonMembership(R_blk[e_now], srcId_i, w_nm_i) = 1`。
11. 若 `isRetained_i = 0`，则 `w_nm_i` 不参与语义约束。

该关系表达的语义是：提现时检查 note 中当前仍被保留的所有真实 source slots，而不是只检查在 `e_now` 下仍然活跃的那部分 slots。超过 `T` 个 epoch 的 source 只有在一次成功的 transfer 中被 prune 出后，才不再影响后续 POI。

### 8. 关于 `Canon_e` 与 `K` padding

当前版本已经显式定义 `Canon_e` 和 `K` 个 source 的 padding 规则。

对于任意 transfer，电路语义要求：

1. 输入 notes 的真实 source 先按 concat 方式收集。
2. 在当前 epoch 下过滤掉超过 `T` 个 epoch 的旧 source。
3. 对同一 `srcId` 的重复出现做一致性检查和去重。
4. 按 `srcId` 排序。
5. 若结果长度不超过 `K`，则用 `(0,0)` 补齐到 `K` 个 slot。
6. 若结果长度超过 `K`，则 proof 直接失败。

但在实现层，建议不要在电路里直接实现一个通用的排序网络或去重算法。更简单的方式是：

1. 在电路外由 prover 计算好 `Slots_out`。
2. 在电路里只验证 `Slots_out` 满足 `WellFormed`。
3. 再通过 `sel_{i,j,k}` 验证“每个输入活跃 source 都被覆盖”以及“每个输出真实 source 都有输入来源”。
4. 另外单独验证每个输入保留 source 都通过当前 blacklist 的 non-membership 检查。
5. 利用 `Slots_out` 的严格递增约束来承载 `unique` 语义。

这样就把“构造 canonical 结果”改成了“验证 witness 给出的结果已经 canonical”，通常比在电路里直接做 `sort + unique` 更自然。

### 9. 实现约束与边界条件

为了让上述规格可直接落地到 `circom`，实现上建议固定以下约束：

1. blacklist 使用有序 indexed Merkle tree，并复用 Privacy Pools 的 non-membership 证明结构。
2. `T` 直接按 epoch 计，不再引入 `DeltaEpoch`。
3. `K` 是强约束而不是建议值；如果 `|UniqueBySrcId(Active_e(U_raw))| > K`，电路必须拒绝，不能在电路外悄悄截断。
4. `shield_transfer` 的所有输出 notes 共享同一个 `sourcesRoot_out`。
5. `circom` 建议直接固定 `MAX_INPUTS` 和 `MAX_OUTPUTS`，并用 `inUsed_i` / `outUsed_j` 处理未使用的输入输出。
6. 第一版实现建议从较小实例开始，例如 `K = 16`、`MAX_INPUTS = 2`、`MAX_OUTPUTS = 2`。
