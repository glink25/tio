# 表格自动化调研

调研时间：2026-10-28。以下产品能力来自官方说明；Tio 设计取舍属于结合当前仓库和 provider 约束的推论。

| 产品                                                                                                                    | 触发时机                                                     | 操作与编排                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| [Airtable](https://support.airtable.com/articles/3669392397-Getting-started-with-Airtable-automations)                  | 新增记录、字段更新、进入条件/视图、表单、定时、Webhook、按钮 | 查找、新增、更新、删除记录；条件分组、遍历、脚本与外部集成 |
| [Notion](https://www.notion.com/help/database-automations)                                                              | 数据库新增页面、属性编辑、周期触发                           | 编辑属性、新增/编辑页面、变量、连续动作、消息与 Webhook    |
| [Lark Base](https://www.larksuite.com/hc/en-US/articles/559049381351-triggers-and-actions-for-workflow-and-automations) | 新增/修改记录、满足条件、日期、定时、按钮等                  | 查找、新增、修改记录以及协作应用操作                       |
| [Coda](https://help.coda.io/hc/en-us/articles/39555778179853-Automations-in-Coda)                                       | 行变化、定时、表单、Webhook                                  | 增改删行、条件判断、顺序执行、外部 Pack                    |

## 借鉴与取舍

- [Airtable 的进入条件](https://support.airtable.com/articles/7369519794-airtable-automation-trigger-when-record-matches-conditions)区分“从不满足变为满足”和“更新后仍满足”；启用规则不会补跑已有记录。Tio 使用独立的条件进入触发器，并把新增匹配留给新增触发器。
- Notion 使用约三秒的属性组合窗口；Coda 不承诺瞬时执行，公式变化不触发行变化。Tio 采用提交成功后的语义事件，明确 provider 的执行窗口与保障，不承诺每次键入均实时触发。
- Notion 和 Coda 禁止自动化触发其他自动化；[Airtable 排障](https://support.airtable.com/articles/6756755850-troubleshooting-airtable-automations)说明自动化写入可能导致循环。Tio 根据产品选择支持有界链路，并检测重复规则、限制深度、运行次数和写入量。
- 删除不是通用表格产品的一致能力；[Airtable 当前支持删除动作](https://support.airtable.com/articles/3654471544-airtable-automation-action-delete-record)。Tio 采用自身软删除契约，页面删除保留删除前快照，适合维护页面索引。

首版优先支持空间内条件筛选、记录增改删、正文模板和多步动作。按钮、定时、日期、Webhook 与外部集成可由未来 provider 扩展；当前不提供这些触发器。文件 provider 依赖用户/AI 的主动编辑，不推测外部文件修改，也不增加持久任务队列。实现契约见[自动化](../architecture/automation.md)。
