# 数据库字段与查询

字段定义保存在 `Field`，记录值按字段 ID 保存在 `TioObject.properties`。名称不是身份，字段移除后保留已有值。标题列类型显示为 ID，固定首列且不可隐藏、删除或修改类型，其他已知类型可在属性编辑器中修改；派生字段禁止直接写入。

| 类型                         | 当前值与语义                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| title/text、number、checkbox | 字符串、有限数值、布尔值                                                              |
| select/multiselect/status    | 稳定选项 ID；多选为数组；状态组为 todo/doing/done                                     |
| date                         | `{start, end?, timeZone?}`，日期用 YYYY-MM-DD，时刻含偏移量                           |
| files                        | 有序且不重复的 `asset:<id>` 数组，单文件上限 20 MiB                                   |
| relation                     | 同空间指定数据库的记录 ID，默认数组，`multiple: false` 时为单值                       |
| mention                      | 同空间页面或数据库引用，默认有序且不重复的数组；`multiple: false` 时为单个引用或 null |
| url                          | HTTP/HTTPS 字符串，空字符串或 null 清空                                               |
| formula/rollup               | 只读计算值，不作为记录缓存持久化                                                      |
| createdTime/lastEditedTime   | 读取 createdAt/updatedAt 时间元数据                                                   |

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

查询先过滤排序再分页。命名视图独立保存布局、过滤、排序和可见字段。提及支持“多条数据”开关；多条转单条保留第一项，单条转多条包装为数组。提及按完整身份比较，多条值等值筛选匹配任一项，相等性不依赖标题；排序与展示使用可读标题，删除目标不清空值。

输入层暂存值，在确认或 Enter 提交，Escape 取消。普通 patch、事务和单元格命令共享引用及属性校验。命令入队时固定时间戳，重放不产生新时间；编辑和撤销更新修改时间，重算不写时间元数据。

## 列类型转换

类型修改通过运行时读取全部记录，以同一版本提交字段定义和转换值，整体支持撤销和重做；权限不足或版本冲突时不提交部分修改。字段 ID 与列顺序保持稳定，公式和筛选仍引用同一字段；不兼容的计算返回现有类型错误。

文本转换为数字、日期、勾选、网址、邮箱和电话时严格校验，无法转换的单元格清空。转文本使用可读值；选项按标签映射，多选转单选取首项，文本转多选按逗号或换行拆分。关系、提及和附件不根据名称猜测引用。派生列转普通列使用当前计算值；转派生列删除原持久化值，并按新配置计算。
