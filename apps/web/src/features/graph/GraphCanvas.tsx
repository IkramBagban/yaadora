import { useEffect } from 'react';
import '@xyflow/react/dist/style.css';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { MemoEntityNode } from './EntityNode';
import { MemoRelationEdge } from './RelationEdge';
import type { EntityFlowNode, RelationFlowEdge } from './graphModel';
import { typeColorVar } from './graphModel';

/** Defined once at module scope so xyflow never re-creates the component map. */
const NODE_TYPES = { entity: MemoEntityNode };
const EDGE_TYPES = { relation: MemoRelationEdge };

export interface GraphCanvasProps {
  nodes: EntityFlowNode[];
  edges: RelationFlowEdge[];
  /** Search jump: recentres + zooms onto this node. New object per jump. */
  jumpTo: { id: string } | null;
  /** Bumped whenever filters/focus swap the visible graph, to refit the view. */
  fitNonce: number;
  onSelectNode: (id: string) => void;
}

function Flow({ nodes, edges, jumpTo, fitNonce, onSelectNode }: GraphCanvasProps) {
  const [stateNodes, setNodes, onNodesChange] = useNodesState<EntityFlowNode>(nodes);
  const instance = useReactFlow();

  // Derived arrays change only with dataset/filters/focus — never on drag,
  // so dragged positions survive until the user changes what's on screen.
  useEffect(() => {
    setNodes(nodes);
  }, [nodes, setNodes]);

  useEffect(() => {
    if (fitNonce === 0) return;
    // Let the node observer measure newly mounted nodes before fitting.
    const timer = setTimeout(() => {
      void instance.fitView({ padding: 0.15, duration: 450, maxZoom: 1.1 });
    }, 80);
    return () => clearTimeout(timer);
  }, [fitNonce, instance]);

  useEffect(() => {
    if (!jumpTo) return;
    const node = instance.getNode(jumpTo.id);
    if (!node) return;
    const half = (node.data as EntityFlowNode['data']).diameter / 2;
    void instance.setCenter(node.position.x + half, node.position.y + half, {
      zoom: 1.4,
      duration: 600,
    });
  }, [jumpTo, instance]);

  return (
    <ReactFlow
      className="h-full w-full"
      nodes={stateNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.1}
      maxZoom={2.5}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: false }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1.2}
        color="var(--c-ink3)"
        bgColor="inherit"
      />
      <Controls position="bottom-right" showInteractive={false} />
      <MiniMap
        position="top-right"
        pannable
        zoomable
        nodeColor={(node) => typeColorVar((node.data as EntityFlowNode['data']).entity.type)}
        nodeStrokeWidth={0}
        nodeBorderRadius={3}
        style={{ width: 180, height: 120 }}
      />
    </ReactFlow>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
