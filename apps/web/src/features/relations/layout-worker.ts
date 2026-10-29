import cytoscape, { type LayoutOptions, type ElementDefinition } from 'cytoscape';
import fcose from 'cytoscape-fcose';
cytoscape.use(fcose);
self.onmessage = (event: MessageEvent<{ elements: ElementDefinition[] }>) => {
  const graph = cytoscape({
    headless: true,
    styleEnabled: true,
    style: [{ selector: 'node', style: { width: 160, height: 65 } }],
    elements: event.data.elements,
  });
  try {
    graph
      .layout({
        name: 'fcose',
        quality: graph.nodes().length > 300 ? 'draft' : 'default',
        randomize: true,
        animate: false,
        packComponents: false,
        samplingType: false,
        sampleSize: 25,
        nodeSeparation: 160,
        idealEdgeLength: 120,
        numIter: 500,
      } as LayoutOptions)
      .run();
    self.postMessage({
      positions: graph.nodes().map((node) => ({ id: node.id(), ...node.position() })),
    });
  } catch {
    self.postMessage({ error: true });
  } finally {
    graph.destroy();
  }
};
