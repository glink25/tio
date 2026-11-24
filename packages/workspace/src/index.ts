import { id, object, textBlock, visible, type Field, type TioObject } from '@tio/core';

const defaultWorkspaceCopy = {
  'common.untitled': '未命名',
  'workspace.starterIntro': '留一点空间，记录你的想法。',
  'workspace.starterLead': '从这里开始。',
  'workspace.starterTitle': '开始',
  'workspace.starterInsert': '输入 / 添加内容。',
  'workspace.starterStyle': '选中文字，试试不同样式。',
  'workspace.databaseTitleField': '名称',
  'workspace.databaseTodo': '待开始',
  'workspace.databaseDoing': '进行中',
  'workspace.databaseDone': '已完成',
  'workspace.databaseDefaultView': '默认视图',
  'workspace.newDatabase': '新数据库',
  'workspace.databaseStatus': '状态',
};
type WorkspaceCopy = (key: keyof typeof defaultWorkspaceCopy) => string;
const workspaceCopy: WorkspaceCopy = (key) => defaultWorkspaceCopy[key];

export function starterWorkspace(name: string, copy: WorkspaceCopy = workspaceCopy): TioObject[] {
  if (!name.trim()) throw new Error('Workspace name is required');
  const workspaceId = id('workspace');
  const intro = textBlock(copy('workspace.starterIntro'));
  intro.content = [
    { type: 'text', text: copy('workspace.starterLead'), styles: { bold: true } },
    ...(intro.content as unknown[]),
  ];
  return [
    object('workspace', workspaceId, { id: workspaceId, name: name.trim() }),
    object('page', workspaceId, {
      title: copy('workspace.starterTitle'),
      parentId: null,
      order: 0,
      blocks: [
        intro,
        {
          ...textBlock(copy('workspace.starterInsert')),
          type: 'bulletListItem',
        },
        {
          ...textBlock(copy('workspace.starterStyle')),
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
export function newPage(
  workspaceId: string,
  parentId: string | null = null,
  copy: WorkspaceCopy = workspaceCopy,
): TioObject {
  return object('page', workspaceId, {
    title: copy('common.untitled'),
    parentId,
    blocks: [textBlock('')],
  });
}
export function newDatabase(
  workspaceId: string,
  parentId: string | null = null,
  copy: WorkspaceCopy = workspaceCopy,
): TioObject[] {
  const title: Field = {
    id: id('field'),
    name: copy('workspace.databaseTitleField'),
    type: 'title',
  };
  const status: Field = {
    id: id('field'),
    name: copy('workspace.databaseStatus'),
    type: 'status',
    options: [
      { id: id('option'), label: copy('workspace.databaseTodo'), color: 'gray', group: 'todo' },
      { id: id('option'), label: copy('workspace.databaseDoing'), color: 'blue', group: 'doing' },
      { id: id('option'), label: copy('workspace.databaseDone'), color: 'green', group: 'done' },
    ],
  };
  const fields = [title, status];
  const db = object('database', workspaceId, {
    name: copy('workspace.newDatabase'),
    parentId,
    fields,
  });
  return [
    db,
    object('databaseView', workspaceId, {
      databaseId: db.id,
      name: copy('workspace.databaseDefaultView'),
      layout: 'table',
      visibleFieldIds: fields.map((field) => field.id),
      filters: [],
      sorts: [],
      groupBy: status.id,
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

export { navigationOrder, navigationTree, projectNavigationMove } from './navigation';
