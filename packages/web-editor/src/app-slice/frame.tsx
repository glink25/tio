import { type Block, type TioObject } from '@tio/core';
import { useTranslation } from '@tio/i18n';
import { useTheme } from '@tio/ui';
import { useEffect, useMemo, useRef } from 'react';

import type { EditorController } from '../controller';
import { AppSliceBroker } from './broker';
import { runnerDocument } from './runner';
import { defaultPermission, MAX_MESSAGE, type AppSlicePermission } from './types';
export function Frame({
  model: m,
  page,
  block,
  html,
  permission,
  preview,
  height,
  onHeight,
  log,
  generation,
  fullscreen = false,
}: {
  model: EditorController;
  page: TioObject;
  block: Block;
  html: string;
  permission: AppSlicePermission;
  preview?: boolean;
  height: number;
  onHeight: (height: number) => void;
  log: (message: string) => void;
  generation: number;
  fullscreen?: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const live = useRef({ m, permission, onHeight, log, fullscreen });
  live.current = { m, permission, onHeight, log, fullscreen };
  const theme = useTheme();
  const { i18n } = useTranslation();
  const token = useMemo(() => {
    void html;
    void permission.data;
    void permission.allowExternalResources;
    void generation;
    void theme;
    void i18n.language;
    void m.hostReadOnly;
    return crypto.randomUUID();
  }, [
    html,
    permission.data,
    permission.allowExternalResources,
    generation,
    theme,
    i18n.language,
    m.hostReadOnly,
  ]);
  const srcDoc = useMemo(
    () => runnerDocument(token, permission.allowExternalResources),
    [token, permission.allowExternalResources],
  );
  useEffect(() => {
    let connected = false,
      disposed = false,
      port: MessagePort | undefined;
    let requests = 0,
      logs = 0,
      started = Date.now();
    const broker = new AppSliceBroker({
      runtime: m.runtime,
      pageId: page.id,
      blockId: block.id,
      workspaceId: page.workspaceId,
      permission: () => {
        const settings = live.current.m.appSlice;
        const key = JSON.stringify([
          settings.namespace ?? 'local',
          page.workspaceId,
          page.id,
          block.id,
        ]);
        const grant = settings.permissionStore?.get(key) ?? defaultPermission;
        // Revocations apply immediately. Permission expansion belongs to the new iframe
        // session; the outgoing frame must not enable controls just before replacement.
        return {
          data:
            preview || live.current.m.hostReadOnly || permission.data !== 'readWrite'
              ? 'read'
              : grant.data,
          allowExternalResources: permission.allowExternalResources && grant.allowExternalResources,
        };
      },
      readOnly: () => live.current.m.hostReadOnly,
      context: () => ({
        theme,
        locale: i18n.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      resize: (h) => {
        if (!live.current.fullscreen) live.current.onHeight(h);
      },
    });
    const close = () => {
      disposed = true;
      broker.dispose();
      port?.close();
    };
    const stop = broker.subscribe((payload) => {
      if (!disposed) port?.postMessage({ kind: 'changed', payload });
    });
    const receive = (event: MessageEvent) => {
      if (
        disposed ||
        connected ||
        event.source !== ref.current?.contentWindow ||
        event.data?.kind !== 'tio-ready' ||
        event.data?.token !== token
      )
        return;
      connected = true;
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (event) => {
        if (disposed) return;
        if (Date.now() - started >= 1000) {
          requests = 0;
          logs = 0;
          started = Date.now();
        }
        const msg = event.data;
        let size: number;
        try {
          size = JSON.stringify(msg).length;
        } catch {
          close();
          return;
        }
        if (size > MAX_MESSAGE) {
          close();
          return;
        }
        if (msg?.kind === 'closed') {
          close();
          return;
        }
        if (msg?.kind === 'log') {
          if (++logs < 20) live.current.log(String(msg.message).slice(0, 4000));
          return;
        }
        if (
          msg?.protocol !== 1 ||
          msg.kind !== 'request' ||
          typeof msg.id !== 'string' ||
          msg.id.length > 200 ||
          typeof msg.method !== 'string'
        )
          return;
        const reply = (data: unknown) => {
          if (!disposed) port?.postMessage(data);
        };
        if (++requests > 100) {
          reply({
            id: msg.id,
            error: { code: 'RATE_LIMITED', message: '100 requests per second' },
          });
          return;
        }
        void broker
          .invoke(msg.method, msg.payload, msg.id)
          .then((result) => {
            if (JSON.stringify(result ?? null).length > MAX_MESSAGE)
              throw new Error('Response too large; use pagination');
            reply({ id: msg.id, result });
          })
          .catch((error) =>
            reply({
              id: msg.id,
              error: { code: error.code ?? 'INVALID_INPUT', message: error.message },
            }),
          );
      };
      ref.current?.contentWindow?.postMessage({ kind: 'tio-connect', token, html }, '*', [
        channel.port2,
      ]);
    };
    window.addEventListener('message', receive);
    // First document load is allowed. Subsequent loads revoke the old session.
    let loads = 0;
    const load = () => {
      if (++loads > 1) close();
    };
    const frame = ref.current;
    frame?.addEventListener('load', load);
    return () => {
      close();
      stop();
      window.removeEventListener('message', receive);
      frame?.removeEventListener('load', load);
    };
  }, [
    token,
    m.runtime,
    page.id,
    page.workspaceId,
    block.id,
    html,
    preview,
    theme,
    i18n.language,
    permission.data,
    permission.allowExternalResources,
  ]);
  return (
    <iframe
      key={token}
      ref={ref}
      title={preview ? 'App Slice preview' : String(block.props.title)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={m.appSlice.runtimeUrl ? undefined : srcDoc}
      src={
        m.appSlice.runtimeUrl
          ? `${m.appSlice.runtimeUrl}${m.appSlice.runtimeUrl.includes('?') ? '&' : '?'}external=${permission.allowExternalResources ? '1' : '0'}#token=${token}`
          : undefined
      }
      style={{
        display: 'block',
        width: '100%',
        height: fullscreen ? '100%' : height,
        border: 0,
        background: 'white',
        colorScheme: 'light',
      }}
    />
  );
}
