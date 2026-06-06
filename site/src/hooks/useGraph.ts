import { useState, useEffect, useMemo } from 'react';
import { GraphData, Dataset, DatasetKey } from '../types';
import { GraphIndex } from '../types';
import { buildGraphIndex } from '../lib/graphIndex';

export type LoadState = 'loading' | 'error' | 'ready';

export interface UseGraphResult {
  loadState: LoadState;
  errorMessage: string | null;
  graphData: GraphData | null;
  activeDataset: Dataset | null;
  activeKey: DatasetKey;
  setActiveKey: (k: DatasetKey) => void;
  graphIndex: GraphIndex | null;
  hasBoth: boolean;
}

export function useGraph(): UseGraphResult {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [activeKey, setActiveKey] = useState<DatasetKey>('experimental');

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrorMessage(null);

    fetch(`${import.meta.env.BASE_URL}graph.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json() as Promise<GraphData>;
      })
      .then((data) => {
        if (cancelled) return;
        // Default to experimental if available, else stable
        if (!data.experimental && data.stable) {
          setActiveKey('stable');
        } else {
          setActiveKey('experimental');
        }
        setGraphData(data);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        setLoadState('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeDataset = useMemo<Dataset | null>(() => {
    if (!graphData) return null;
    return graphData[activeKey] ?? null;
  }, [graphData, activeKey]);

  const graphIndex = useMemo<GraphIndex | null>(() => {
    if (!activeDataset) return null;
    return buildGraphIndex(activeDataset.edges);
  }, [activeDataset]);

  const hasBoth = Boolean(graphData?.stable && graphData?.experimental);

  return {
    loadState,
    errorMessage,
    graphData,
    activeDataset,
    activeKey,
    setActiveKey,
    graphIndex,
    hasBoth,
  };
}
