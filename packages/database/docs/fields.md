# 数据库字段与查询

字段定义保存在 `Field`，记录值按字段 ID 保存在 `TioObject.properties`。名称不是身份，字段移除后保留已有值。字段类型创建后锁定，派生字段禁止写入。

| 类型                         | 当前值与语义                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| title/text、number、checkbox | 字符串、有限数值、布尔值                                        |
| select/multiselect/status    | 稳定选项 ID；多选为数组；状态组为 todo/doing/done               |
| date                         | `{start, end?, timeZone?}`，日期用 YYYY-MM-DD，时刻含偏移量     |
| files                        | 有序且不重复的 `asset:<id>` 数组，单文件上限 20 MiB             |
| relation                     | 同空间指定数据库的记录 ID，默认数组，`multiple: false` 时为单值 |
| mention                      | `{workspaceId, kind: 'page'                                     | 'database', id}` 或 null |
| url                          | HTTP/HTTPS 字符串，空字符串或 null 清空                         |
| formula/rollup               | 只读计算值，不作为记录缓存持久化                                |
| createdTime/lastEditedTime   | 读取 createdAt/updatedAt 时间元数据                             |

日期输入检查时区、DST 空洞和区间。日/月/年运算保留墙上时间，小时/分钟表示流逝时间。文件字节使用既有暂存与发布管道，移除属性引用不删除共享附件。关系忽略缺失/已删除记录参与计算，但保留引用以供展示。

## 公式与汇总

`compileFormula` 把输入名称绑定到稳定字段 ID，歧义名称必须显式选择。`formulaSource` 显示当前名称。表达式支持字面值、括号、算术、比较、逻辑操作及以下函数：

- `prop/if/empty/format/toNumber`
- `abs/round/floor/ceil/min/max`
- `concat/length/contains/replace/lower/upper`
- `dateStart/dateEnd/dateAdd/dateBetween/formatDate/now/today`

这是受限解释器，不执行 JavaScript，也不承诺完整 Notion Formula 2.0。`if` 分支惰性计算。日期单位为 minutes/hours/days/weeks/months/years；格式支持 YYYY/MM/DD/HH/mm/ss。可见文档中的时间计算每分钟刷新。

汇总配置为 `Field.rollup: {relationFieldId, targetFieldId, operation}`。数值/日期聚合检查定义与实际值；空计数/求和为零，空平均值/极值为 null。

## 编辑与读取

`createEvaluator(objects, now)` 针对不可变快照提供缓存的 `read/value/project`。循环、过深依赖和类型错误返回显式错误。视图和查询使用同一计算器，空值/错误排在最后，错误不满足值过滤。

查询先过滤排序再分页。命名视图独立保存布局、过滤、排序和可见字段。提及按完整身份比较，相等性不依赖标题；排序与展示使用可读标题，删除目标不清空值。

输入层暂存值，在确认或 Enter 提交，Escape 取消。普通 patch、事务和单元格命令共享引用及属性校验。命令入队时固定时间戳，重放不产生新时间；编辑和撤销更新修改时间，重算不写时间元数据。
