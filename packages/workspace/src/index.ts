import { id, object, textBlock, visible, type TioObject } from '@tio/core';

export function starterWorkspace(name: string, language: 'zh' | 'en' = 'zh'): TioObject[] {
  if (!name.trim()) throw new Error('Workspace name is required');
  const en = language === 'en';
  const workspaceId = id('workspace');
  const intro = textBlock(en ? 'A little space for your ideas.' : '留一点空间，记录你的想法。');
  intro.content = [
    { type: 'text', text: en ? 'Start here.' : '从这里开始。', styles: { bold: true } },
    ...(intro.content as unknown[]),
  ];
  return [
    object('workspace', workspaceId, { id: workspaceId, name: name.trim() }),
    object('page', workspaceId, {
      title: en ? 'Getting started' : '开始',
      parentId: null,
      order: 0,
      blocks: [
        intro,
        {
          ...textBlock(en ? 'Type / to add content.' : '输入 / 添加内容。'),
          type: 'bulletListItem',
        },
        {
          ...textBlock(en ? 'Select text to change its style.' : '选中文字，试试不同样式。'),
          type: 'bulletListItem',
        },
      ],
    }),
  ];
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
