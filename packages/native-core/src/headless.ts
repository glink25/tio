import './intl';
import { giteeEndpointsKey } from '@tio/provider-gitee';
import { gitConnection } from '@tio/provider-github/credentials';
export { runBackground } from './background';
export { syncGit } from './sync';
import {
  HostError,
  textBlock,
  type Block,
  type WorkspaceRepository,
  type WorkspaceSession,
} from '@tio/core';
import { WorkspaceOperations, type ObjectRead } from '@tio/operations';
import { githubEndpointsKey, type GitHubEndpoint } from '@tio/provider-github';
import { WorkspaceRuntime } from '@tio/workspace';

import { nativeFolderGrant } from './folder';
import { NativeRepository } from './native-repository';
import { withProcessLock } from './process-lock';
import { ReplicaRepository } from './replica';

declare function tioWorkspace(space: string, request: string): string;

declare function tioNative(request: string): string;
interface Shortcut {
  connection?: string;
  action: 'read' | 'append' | 'create';
  workspace: string;
  document?: string;
  text?: string;
  title?: string;
}

export async function run(input: Shortcut) {
  if (input.connection && input.connection !== 'device') {
    const connection = input.connection;
    const folder = !!nativeFolderGrant(connection);
    const account = gitConnection(connection);
    if (!folder && !account) throw new HostError('invalid');
    const call = async <T>(request: Record<string, unknown>): Promise<T> => {
      const reply = JSON.parse(tioNative(JSON.stringify(request)));
      if (reply.error) throw new HostError(reply.error);
      return reply.value;
    };
    const sessions = await call<WorkspaceSession[]>({ action: 'sessions' });
    const session = sessions.find(
      (value) => value.connectionId === connection && value.workspaceId === input.workspace,
    );
    if (!session) throw new HostError('unavailable');

    const open = async (instance: string) => {
      if (await call({ action: 'read', key: 'workspace-lifecycle/' + session.id }))
        throw new HostError('closed');
      const repository = new ReplicaRepository(instance, input.workspace, (space, action, args) =>
        call({ action: 'replica', replica: instance, space, request: { action, ...args } }),
      );
      try {
        return await runDocumentOperation(input, repository, folder ? 'pending' : 'unavailable');
      } finally {
        repository.close();
      }
    };

    if (folder) {
      return withProcessLock(
        'tio-folder-local-' + session.id,
        () => open(session.id),
        (name, token) => call({ action: 'lock', name, token }),
      );
    }
    const endpoints = await call<[string, GitHubEndpoint][] | undefined>({
      action: 'read',
      key: (account?.provider === 'gitee' ? giteeEndpointsKey : githubEndpointsKey)(connection),
    });
    const endpoint = endpoints?.find(([id]) => id === input.workspace)?.[1];
    if (!endpoint || endpoint.workspaceId !== input.workspace) throw new HostError('unavailable');
    const instance = session.id + '/' + endpoint.repositoryId + '/' + endpoint.branch;
    if ((await call({ action: 'read', key: 'replica-complete/' + instance })) !== true)
      throw new HostError('pending');
    return open(instance);
  }
  const repo = new NativeRepository(input.workspace, async (space, action, args) => {
    const reply = JSON.parse(tioWorkspace(space, JSON.stringify({ action, ...args })));
    if (reply.error) throw new HostError(reply.error);
    return reply.value;
  });
  try {
    return await runDocumentOperation(input, repo);
  } finally {
    repo.close();
  }
}

async function runDocumentOperation(
  input: Shortcut,
  repository: WorkspaceRepository,
  unavailable: 'unavailable' | 'pending' = 'unavailable',
) {
  const root = (await repository.readObjects!([input.workspace])).entries[0]?.object;
  if (root?.type !== 'workspace' || root.deleted)
    throw new HostError(root?.deleted ? 'unavailable' : unavailable);
  const runtime = await WorkspaceRuntime.open(repository, undefined, undefined, {
    targetId: input.document,
  });
  const paragraph = input.text === undefined ? undefined : textBlock(input.text);
  const operations = new WorkspaceOperations({
    runtime,
    workspaceId: input.workspace,
    async validateBlocks(before: Block[], after: Block[]) {
      // Shortcuts may append exactly the locally constructed paragraph. Existing opaque blocks are preserved.
      if (!paragraph || JSON.stringify(after) !== JSON.stringify([...before, paragraph]))
        throw new HostError('invalid');
    },
  });
  const call = async (name: string, args: unknown) => {
    let result = await operations.invoke(name, args, crypto.randomUUID(), () => {});
    while (result.status === 'pending') {
      await new Promise((resolve) => setTimeout(resolve, 25));
      result = await operations.result(result.requestId, () => {});
    }
    if (result.status === 'failed')
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
  };
  try {
    if (input.action === 'create') {
      return await call('pages.create', {
        title: input.title,
        blocks: paragraph ? [paragraph] : [],
      });
    }
    const page = (await call('objects.get', { id: input.document })) as ObjectRead;
    if (page.object.type !== 'page') throw new HostError('invalid');
    if (input.action === 'read') return page.object;
    if (input.action !== 'append' || !paragraph) throw new HostError('invalid');
    return await call('blocks.insert', {
      id: input.document,
      version: page.version,
      blocks: [paragraph],
    });
  } finally {
    operations.dispose();
    await runtime.close();
  }
}
