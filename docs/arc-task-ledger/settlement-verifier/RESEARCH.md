# 主网语义核对

核查日期2026-10-07；只引用与本轮实现直接相关的官方说明。

[Arc连接文档](https://docs.arc.io/arc/references/connect-to-arc)登记主网链ID5042、explorer.arc.io及已有免费dRPC来源；没有借凭据新增付费来源。该登记不替代每次链ID与区块摘要核对。

[USDC系统事件](https://docs.arc.io/arc/references/usdc-system-events)登记主网自创世采用系统Transfer，系统emitter为0xfffffffffffffffffffffffffffffffffffffffe，18位；ERC20接口0x3600000000000000000000000000000000000000，6位。系统转移作为规范事件，ERC20镜像按数量交叉核查，不能相加。旧测试网NativeCoin事件不属于本轮支持网络。系统零值/自转不产生日志，mint/burn通过零地址区分；若原件出现与登记语义冲突的系统日志，不认定普通付款。Gas依回执gasUsed×effectiveGasPrice单列，不伪造Transfer。

[原生稳定币模型](https://docs.arc.io/arc/concepts/stablecoin-native-model)明确两接口共享一个余额；ERC20余额精度不呈现18位原生余额全部尾数。金额比较始终使用18位原子BigInt，显示精度不参与判定。锁登记见usdc-network.json，旧deployment.json保留并检查两处地址一致。

本轮只读取公开主网交易，不创建付款。RPC来源声明finalized与密码学收据树证明不同；固定交易覆盖与完整任务历史分别报告。
