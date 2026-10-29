import type { ContentTarget } from './targets';
export interface ReferenceQuery {
  id: string;
  direction: 'in' | 'out';
  after?: string;
  limit: number;
}
export interface OccurrenceQuery {
  sourceId: string;
  targetId: string;
  after?: string;
  limit: number;
}
export interface GraphQuery {
  after?: string;
  limit: number;
}
export interface ReferenceNode {
  target: ContentTarget;
  title: string;
}
export interface ReferenceGroup {
  node: ReferenceNode;
  count: number;
  status: 'ready' | 'unavailable';
}
export interface ReferenceOccurrence {
  source: ContentTarget;
  target: ContentTarget;
  excerpt: string;
  fieldName?: string;
}
export interface RelationPage<T> {
  version: string;
  status: 'building' | 'partial' | 'ready';
  complete: boolean;
  items: T[];
  next?: string;
  total?: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  count: number;
}
export type GraphItem = { type: 'node'; node: ReferenceNode } | { type: 'edge'; edge: GraphEdge };
export interface RelationsProvider {
  queryReferences(query: ReferenceQuery): Promise<RelationPage<ReferenceGroup>>;
  queryReferenceOccurrences(query: OccurrenceQuery): Promise<RelationPage<ReferenceOccurrence>>;
  queryGraph(query: GraphQuery): Promise<RelationPage<GraphItem>>;
  subscribe(listener: (reason: 'content' | 'ready' | 'access') => void): () => void;
}
export interface SearchHit {
  id: string;
  target: ContentTarget;
  title: string;
  path: string;
  excerpt: string;
}
