import { HostError, type ReferenceNode } from '@tio/core';
import { useT } from '@tio/i18n';
import { Button, IconButton, LoadingIndicator, ObjectIcon, useTheme } from '@tio/ui';
import cytoscape, { type Core } from 'cytoscape';
import { ArrowLeft, ArrowUpRight, Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { WorkspaceController } from '../workspace/use-workspace';
import databaseIcon from './icons/database.svg';
import pageIcon from './icons/page.svg';
import recordIcon from './icons/record.svg';

function fitGraph(graph: Core) {
  graph.fit(undefined, 60);
  if (graph.zoom() > 1.2) {
    graph.zoom(1.2);
    graph.center();
  }
}

export default function RelationshipGraph({ model: m }: { model: WorkspaceController }) {
  const t = useT();
  const theme = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core>();
  const [nodes, setNodes] = useState<ReferenceNode[]>([]);
  const [selected, setSelected] = useState(m.selected);
  const [query, setQuery] = useState('');
  const [showNodes, setShowNodes] = useState(false);
  const [listLimit, setListLimit] = useState(100);
  const [status, setStatus] = useState<'loading' | 'partial' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const provider = m.runtime?.relations;
  const graphVisible = status === 'ready' || status === 'partial';
  const navigate = useRef(m.navigateTarget);
  navigate.current = m.navigateTarget;
  useEffect(() => {
    const instance = cytoscape({
      container: container.current!,
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            width: 30,
            height: 30,
            'background-image': pageIcon,
            'background-width': '65%',
            'background-height': '65%',
            'background-position-x': '50%',
            'background-position-y': '50%',
            'background-repeat': 'no-repeat',
            'background-color': '#888',
            color: '#888',
            'font-size': 11,
            'min-zoomed-font-size': 8,
            'text-valign': 'bottom',
            'text-margin-y': 7,
            'text-max-width': '120px',
            'text-wrap': 'ellipsis',
          },
        },
        { selector: 'node[kind="database"]', style: { 'background-image': databaseIcon } },
        { selector: 'node[kind="record"]', style: { 'background-image': recordIcon } },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#aaa',
            'target-arrow-color': '#aaa',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            opacity: 0.4,
          },
        },
        { selector: '.dim', style: { opacity: 0.35 } },
        {
          selector: 'node.focus',
          style: {
            width: 34,
            height: 34,
            'background-color': '#4b7bec',
            color: '#4b7bec',
            'font-weight': 'bold',
          },
        },
        {
          selector: 'edge.focus',
          style: { 'line-color': '#4b7bec', 'target-arrow-color': '#4b7bec', width: 2, opacity: 1 },
        },
      ],
      minZoom: 0.001,
      maxZoom: 4,
      hideEdgesOnViewport: true,
      // Draw at the actual zoom; viewport textures expose their outside fill when zooming out.
      textureOnViewport: false,
    });
    cy.current = instance;
    instance.on('tap', 'node', (event) => setSelected(event.target.id()));
    instance.on('dbltap', 'node', (event) => void navigate.current({ id: event.target.id() }));
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        instance.resize();
        if (instance.nodes().length) fitGraph(instance);
      });
    });
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
      instance.destroy();
      cy.current = undefined;
    };
  }, []);
  useEffect(() => {
    const instance = cy.current;
    if (!instance || !provider) return;
    let layoutWorker: Worker | undefined;
    let generation = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      layoutWorker?.terminate();
      layoutWorker = undefined;
      const token = ++generation;
      setStatus('loading');
      const accumulated = new Map<string, ReferenceNode>();
      const seen = new Set<string>();
      let after: string | undefined;
      let version: string | undefined;
      let count = 0;
      try {
        do {
          const page = await provider.queryGraph({ after, limit: 1000 });
          if (disposed || token !== generation) return;
          if (version && version !== page.version) throw new HostError('conflict');
          version = page.version;
          instance.batch(() => {
            for (const item of page.items) {
              const key =
                item.type === 'node'
                  ? item.node.target.id
                  : `edge:${item.edge.source}:${item.edge.target}`;
              seen.add(key);
              if (item.type === 'node') {
                accumulated.set(key, item.node);
                if (instance.getElementById(key).length)
                  instance
                    .getElementById(key)
                    .data({ label: item.node.title, kind: item.node.target.kind });
                else
                  instance.add({
                    group: 'nodes',
                    data: { id: key, label: item.node.title, kind: item.node.target.kind },
                    position: { x: (count % 100) * 45, y: Math.floor(count / 100) * 45 },
                  });
              } else if (!instance.getElementById(key).length)
                instance.add({ group: 'edges', data: { id: key, ...item.edge } });
              count++;
            }
          });
          if (page.items.some((item) => item.type === 'node')) setNodes([...accumulated.values()]);
          after = page.next;
          if (!after) {
            setNodes([...accumulated.values()]);
            instance
              .elements()
              .filter((el) => !seen.has(el.id()))
              .remove();
            // Layout only the first snapshot; incremental refresh preserves manually placed nodes.
            if (!instance.scratch('laidOut')) {
              layoutWorker?.terminate();
              layoutWorker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
                type: 'module',
              });
              layoutWorker.onmessage = (event) => {
                if (disposed || token !== generation) return;
                if (event.data.error) {
                  setStatus('error');
                  return;
                }
                instance.batch(() => {
                  for (const position of event.data.positions as {
                    id: string;
                    x: number;
                    y: number;
                  }[])
                    instance.getElementById(position.id).position(position);
                });
                instance.scratch('laidOut', true);
                fitGraph(instance);
                setStatus(page.complete ? 'ready' : 'partial');
                layoutWorker?.terminate();
                layoutWorker = undefined;
              };
              layoutWorker.onerror = () => {
                if (!disposed && token === generation) setStatus('error');
                layoutWorker?.terminate();
                layoutWorker = undefined;
              };
              layoutWorker.postMessage({
                elements: instance
                  .elements()
                  .map((element) => ({ group: element.group(), data: element.data() })),
              });
            } else setStatus(page.complete ? 'ready' : 'partial');
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        } while (after);
      } catch (error) {
        if (disposed || token !== generation) return;
        if (error instanceof HostError && error.code === 'conflict') {
          timer = setTimeout(() => void load(), 150);
          return;
        }
        setStatus('error');
      }
    };
    const stop = provider.subscribe((reason) => {
      generation++;
      clearTimeout(timer);
      setStatus('loading');
      if (reason === 'access') {
        instance.elements().remove();
        setNodes([]);
        instance.scratch('laidOut', false);
      }
      timer = setTimeout(() => void load(), reason === 'access' ? 0 : 150);
    });
    void load();
    return () => {
      layoutWorker?.terminate();
      disposed = true;
      generation++;
      stop();
      clearTimeout(timer);
    };
  }, [provider, retry]);
  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.elements().removeClass('focus dim');
    const focus = instance.getElementById(selected);
    if (focus.length) {
      instance.elements().addClass('dim');
      focus.closedNeighborhood().removeClass('dim');
      focus.addClass('focus');
      focus.connectedEdges().addClass('focus');
    }
  }, [selected, nodes]);
  const node = nodes.find((n) => n.target.id === selected);
  const matches = nodes.filter((n) =>
    n.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section
      className="fixed inset-0 z-30 flex flex-col bg-panel"
      aria-label={t('links.graph')}
      data-theme={theme}
      aria-busy={!!provider && status === 'loading'}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-3">
        <Button onClick={() => void m.navigateTarget({ id: m.selected })}>
          <ArrowLeft size={18} />
          {t('links.back')}
        </Button>
        <h1 className="font-medium">{t('links.graph')}</h1>
        <input
          disabled={!graphVisible}
          aria-label={t('links.search')}
          placeholder={t('links.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setListLimit(100);
          }}
          className="order-last w-full min-w-0 rounded border border-line bg-surface px-3 py-2 sm:order-none sm:w-auto sm:flex-1"
        />
        <Button
          disabled={!graphVisible}
          aria-label={t('links.zoomIn')}
          onClick={() => cy.current?.zoom(cy.current.zoom() * 1.2)}
        >
          <Plus size={16} />
        </Button>
        <Button
          disabled={!graphVisible}
          aria-label={t('links.zoomOut')}
          onClick={() => cy.current?.zoom(cy.current.zoom() / 1.2)}
        >
          <Minus size={16} />
        </Button>
        <Button
          disabled={!graphVisible}
          onClick={() => {
            if (cy.current) fitGraph(cy.current);
          }}
        >
          <Maximize size={16} />
          {t('links.fit')}
        </Button>
      </header>
      <output
        className={provider && status === 'loading' ? 'sr-only' : 'px-4 py-2 text-xs text-muted'}
      >
        {!provider
          ? t('links.unsupported')
          : status === 'loading'
            ? t('links.updating')
            : status === 'partial'
              ? t('links.partial')
              : status === 'error'
                ? t('links.failed')
                : t('links.loaded', { count: nodes.length })}
        {status === 'error' && (
          <Button onClick={() => setRetry((v) => v + 1)}>{t('links.retry')}</Button>
        )}
      </output>
      <div className="relative min-h-0 flex-1">
        <div
          ref={container}
          aria-hidden={!graphVisible}
          style={{
            position: 'absolute',
            inset: 0,
            visibility: graphVisible ? 'visible' : 'hidden',
          }}
        />
        {provider && status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel">
            <LoadingIndicator label={t('links.updating')} />
          </div>
        )}
        {graphVisible && (
          <aside className="absolute inset-x-3 bottom-3 max-h-[35%] overflow-auto rounded-xl border border-line bg-panel/95 p-3 md:inset-x-auto md:top-3 md:right-3 md:bottom-auto md:max-h-[80%] md:w-72">
            {node && (
              <div className="mb-3 flex items-center gap-2">
                <ObjectIcon type={node.target.kind} />
                <span className="min-w-0 flex-1 truncate">{node.title}</span>
                <IconButton
                  label={t('links.open')}
                  onClick={() => void m.navigateTarget(node.target)}
                >
                  <ArrowUpRight size={18} />
                </IconButton>
              </div>
            )}
            <section>
              <button
                className="cursor-pointer text-sm text-muted"
                aria-expanded={showNodes || !!query}
                onClick={() => setShowNodes((v) => !v)}
              >
                {t('links.nodes')} ({matches.length})
              </button>
              {(showNodes || !!query) &&
                matches.slice(0, listLimit).map((n) => (
                  <button
                    key={n.target.id}
                    className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-surface"
                    onClick={() => {
                      setSelected(n.target.id);
                      cy.current?.center(cy.current.getElementById(n.target.id));
                    }}
                  >
                    <ObjectIcon type={n.target.kind} />
                    <span className="truncate">{n.title}</span>
                  </button>
                ))}
              {(showNodes || !!query) && matches.length > listLimit && (
                <Button onClick={() => setListLimit((v) => v + 100)}>{t('links.more')}</Button>
              )}
            </section>
          </aside>
        )}
      </div>
    </section>
  );
}
