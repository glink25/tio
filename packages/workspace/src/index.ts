import { id, object, textBlock, visible, type TioObject } from '@tio/core';

export function sampleWorkspace(language: 'zh' | 'en' = 'zh'): TioObject[] {
  const tr = (zh: string, en: string) => (language === 'en' ? en : zh);
  const workspaceId = id('workspace');
  const workspace = object('workspace', workspaceId, {
    id: workspaceId,
    name: tr('我的工作空间', 'My workspace'),
  });
  const home = object('page', workspaceId, {
    title: tr('开始', 'Getting started'),
    icon: '🌿',
    parentId: null,
    order: 0,
    blocks: [textBlock(tr('输入 / 添加内容。', 'Type / to add content.'))],
  });
  const db = object('database', workspaceId, {
    name: tr('项目计划', 'Project planner'),
    icon: '◫',
    parentId: null,
    order: 1,
    fields: [
      { id: 'title', name: tr('名称', 'Name'), type: 'title' },
      {
        id: 'status',
        name: tr('状态', 'Status'),
        type: 'status',
        options: [
          { id: 'todo', label: tr('待开始', 'To do'), color: 'gray', group: 'todo' },
          { id: 'doing', label: tr('进行中', 'In progress'), color: 'blue', group: 'doing' },
          { id: 'done', label: tr('已完成', 'Done'), color: 'green', group: 'done' },
        ],
      },
      {
        id: 'priority',
        name: tr('优先级', 'Priority'),
        type: 'select',
        options: [
          { id: 'high', label: tr('重要', 'High'), color: 'red' },
          { id: 'normal', label: tr('普通', 'Normal'), color: 'gray' },
        ],
      },
      { id: 'date', name: tr('日期', 'Date'), type: 'date' },
    ],
  });
  const view = object('databaseView', workspaceId, {
    name: tr('全部项目', 'All projects'),
    databaseId: db.id,
    layout: 'table',
    visibleFieldIds: ['title', 'status', 'priority', 'date'],
    filters: [],
    sorts: [],
    groupBy: 'status',
  });
  home.blocks!.push({
    id: id('block'),
    type: 'databaseView',
    props: { databaseId: db.id, viewId: view.id },
    content: [],
    children: [],
  });
  const records = [
    tr('整理第一份灵感笔记', 'Collect your first ideas'),
    tr('设计我的个人知识库', 'Design a personal knowledge workspace'),
    tr('开启一次新的探索', 'Start a new exploration'),
  ].map((t, i) =>
    object('record', workspaceId, {
      databaseId: db.id,
      properties: {
        title: t,
        status: ['done', 'doing', 'todo'][i],
        priority: i === 1 ? 'high' : 'normal',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blocks: [
        textBlock(
          tr('在这里记录背景、想法和下一步。', 'Capture context, ideas, and next steps here.'),
        ),
      ],
    }),
  );
  const note = object('page', workspaceId, {
    title: tr('随手记', 'Quick notes'),
    icon: '✍️',
    parentId: null,
    order: 2,
    blocks: [
      textBlock(
        tr(
          '不必完整，也不必完美。把此刻的想法留下来。',
          'It does not need to be complete or perfect. Just capture this moment.',
        ),
      ),
    ],
  });
  return [workspace, home, db, view, ...records, note];
}
export function search(objects: TioObject[], query: string) {
  const q = query.toLocaleLowerCase();
  return objects.filter(
    (o) =>
      visible(o, objects) &&
      ['page', 'database', 'record'].includes(o.type) &&
      JSON.stringify([o.title, o.name, o.properties, o.blocks]).toLocaleLowerCase().includes(q),
  );
}
export function newPage(workspaceId: string, parentId: string | null = null): TioObject {
  return object('page', workspaceId, {
    title: '未命名',
    parentId,
    order: Date.now(),
    blocks: [textBlock('')],
  });
}
export function newDatabase(workspaceId: string, parentId: string | null = null): TioObject[] {
  const db = object('database', workspaceId, {
    name: '新数据库',
    parentId,
    order: Date.now(),
    fields: [
      { id: id('field'), name: '名称', type: 'title' },
      {
        id: id('field'),
        name: '状态',
        type: 'status',
        options: [
          { id: id('option'), label: '待开始', color: 'gray', group: 'todo' },
          { id: id('option'), label: '进行中', color: 'blue', group: 'doing' },
          { id: id('option'), label: '已完成', color: 'green', group: 'done' },
        ],
      },
    ],
  });
  return [
    db,
    object('databaseView', workspaceId, {
      databaseId: db.id,
      name: '默认视图',
      layout: 'table',
      visibleFieldIds: db.fields!.map((f) => f.id),
      filters: [],
      sorts: [],
      groupBy: db.fields![1].id,
    }),
  ];
}
export {
  WorkspaceRuntime,
  emptyWorkspaceState,
  type WorkspaceState,
  type EditorSession,
} from './runtime';
export { executeBasic, type BasicCommand } from './basic';

export { executeCommand, type WorkspaceCommand } from './commands';
