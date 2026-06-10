import { useState, useEffect, useRef, useMemo } from 'react';
import { Dataset, GraphManifest, GraphIndex } from '../types';
import { buildGraphIndex } from '../lib/graphIndex';

export type LoadState = 'loading' | 'error' | 'ready';

export interface UseGraphResult {
  loadState: LoadState;
  errorMessage: string | null;
  manifest: GraphManifest | null;
  activeDataset: Dataset | null;
  activeModId: string;
  setActiveModId: (id: string) => void;
  graphIndex: GraphIndex | null;
}

function baseUrl(): string {
  return import.meta.env.BASE_URL ?? '/';
}

function cacheBust(file: string): string {
  const sha = import.meta.env.VITE_DEPLOY_SHA;
  return sha ? `${file}?v=${sha.slice(0, 7)}` : file;
}

export function useGraph(): UseGraphResult {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manifest, setManifest] = useState<GraphManifest | null>(null);
  const [activeModId, setActiveModId] = useState<string>('vanilla');
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null);

  // Cache of already-fetched datasets keyed by mod id
  const cache = useRef<Map<string, Dataset>>(new Map());

  // Load manifest on mount
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrorMessage(null);

    const url = `${baseUrl()}${cacheBust('graph-manifest.json')}`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json() as Promise<GraphManifest>;
      })
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        const defaultMod = m.mods.find((e) => e.default) ?? m.mods[0];
        if (defaultMod) setActiveModId(defaultMod.id);
        // Don't set loadState here — the dataset fetch below will do it
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return () => { cancelled = true; };
  }, []);

  // Load dataset whenever activeModId or manifest changes
  useEffect(() => {
    if (!manifest) return;

    const mod = manifest.mods.find((e) => e.id === activeModId);
    if (!mod) return;

    // Already cached
    if (cache.current.has(mod.id)) {
      setActiveDataset(cache.current.get(mod.id)!);
      setLoadState('ready');
      return;
    }

    let cancelled = false;
    setLoadState('loading');

    const url = `${baseUrl()}${cacheBust(mod.file)}`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json() as Promise<Dataset>;
      })
      .then((ds) => {
        if (cancelled) return;
        cache.current.set(mod.id, ds);
        setActiveDataset(ds);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return () => { cancelled = true; };
  }, [manifest, activeModId]);

  const graphIndex = useMemo<GraphIndex | null>(() => {
    if (!activeDataset) return null;
    return buildGraphIndex(activeDataset.edges);
  }, [activeDataset]);

  return {
    loadState,
    errorMessage,
    manifest,
    activeDataset,
    activeModId,
    setActiveModId,
    graphIndex,
  };
}
