import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type Capability,
  type FlapInspectionResponse,
  type HealthResponse,
  type LaunchpadRegistryEntry,
  type PlatformDescriptor,
  type SearchResponse,
  type SubjectCandidate,
  type SubjectResponse,
} from '../generated-api/client.js';
import {
  AnalystWorkspace,
  CapitalWorkspace,
  EvidenceWorkspace,
  ProfitWorkspace,
  SupplyRealityWorkspace,
} from '../workspaces/forensic.js';
import { TokenAnalyzeWorkspace } from '../workspaces/token-analyze.js';
import {
  ClaimAuditWorkspace,
  ControlCampaignWorkspace,
  ControlRightsWorkspace,
  DataHealth,
  EntityIntelligenceWorkspace,
  Header,
  Overview,
  ScenarioLab,
  SearchWorkspace,
  Sidebar,
  type Theme,
  type View,
} from '../workspaces/shell/index.js';

export function App() {
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem('zerotrace-theme') === 'light' ? 'light' : 'dark',
  );
  const [presentation, setPresentation] = useState<'novice' | 'expert'>(() =>
    window.localStorage.getItem('zerotrace-presentation') === 'expert' ? 'expert' : 'novice',
  );
  const [view, setView] = useState<View>('overview');
  const [health, setHealth] = useState<HealthResponse>();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [platforms, setPlatforms] = useState<PlatformDescriptor[]>([]);
  const [launchpadRegistry, setLaunchpadRegistry] = useState<LaunchpadRegistryEntry[]>([]);
  const [loadingCore, setLoadingCore] = useState(true);
  const [coreError, setCoreError] = useState<string>();
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [searchResult, setSearchResult] = useState<SearchResponse>();
  const [subject, setSubject] = useState<SubjectResponse>();
  const [launchInspection, setLaunchInspection] = useState<FlapInspectionResponse>();
  const [launchError, setLaunchError] = useState<string>();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('zerotrace-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.presentation = presentation;
    window.localStorage.setItem('zerotrace-presentation', presentation);
  }, [presentation]);

  const refreshCore = useCallback(async () => {
    setLoadingCore(true);
    try {
      const [nextHealth, nextCapabilities, nextPlatforms] = await Promise.all([
        api.health(),
        api.capabilities(),
        api.platforms(),
      ]);
      setHealth(nextHealth);
      setCapabilities(nextCapabilities.core);
      setPlatforms(nextPlatforms.platforms);
      setLaunchpadRegistry(nextPlatforms.launchpadRegistry);
      setCoreError(undefined);
    } catch (error) {
      setCoreError(error instanceof Error ? error.message : '无法连接接口。');
    } finally {
      setLoadingCore(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshCore(), 0);
    const timer = window.setInterval(() => void refreshCore(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refreshCore]);

  const search = useCallback(async (query: string, network: string) => {
    const mapping: Record<string, { ledger?: string; chainId?: string }> = {
      auto: {},
      ethereum: { ledger: 'EVM', chainId: 'eip155:1' },
      bsc: { ledger: 'EVM', chainId: 'eip155:56' },
      bitcoin: { ledger: 'BITCOIN', chainId: 'bitcoin-mainnet' },
      solana: { ledger: 'SOLANA', chainId: 'solana-mainnet' },
    };
    const selection = mapping[network] ?? {};
    setSearchBusy(true);
    setSearchError(undefined);
    setSubject(undefined);
    setLaunchInspection(undefined);
    setLaunchError(undefined);
    setView('search');
    try {
      setSearchResult(await api.search(query, selection.ledger, selection.chainId));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '检索失败。');
    } finally {
      setSearchBusy(false);
    }
  }, []);

  const inspect = useCallback(async (candidate: SubjectCandidate) => {
    setSearchBusy(true);
    setSearchError(undefined);
    setLaunchInspection(undefined);
    setLaunchError(undefined);
    try {
      const nextSubject =
        candidate.type === 'ADDRESS'
          ? await api.subject(candidate)
          : await api.ledgerRecord(candidate);
      setSubject(nextSubject);
      if (
        candidate.type === 'ADDRESS' &&
        candidate.ledger === 'EVM' &&
        candidate.chainId === 'eip155:56'
      ) {
        try {
          setLaunchInspection(await api.flapLaunch(candidate));
        } catch (error) {
          setLaunchError(error instanceof Error ? error.message : 'Flap Portal 检查失败。');
        }
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '主体检查失败。');
    } finally {
      setSearchBusy(false);
    }
  }, []);

  const content = useMemo(() => {
    if (view === 'analyze') return <TokenAnalyzeWorkspace />;
    if (view === 'search') {
      return (
        <SearchWorkspace
          result={searchResult}
          subject={subject}
          launchInspection={launchInspection}
          launchError={launchError}
          busy={searchBusy}
          error={searchError}
          onSearch={search}
          onInspect={inspect}
        />
      );
    }
    if (view === 'entities') return <EntityIntelligenceWorkspace />;
    if (view === 'control') return <ControlRightsWorkspace />;
    if (view === 'campaigns') return <ControlCampaignWorkspace />;
    if (view === 'supply') return <SupplyRealityWorkspace />;
    if (view === 'capital') return <CapitalWorkspace />;
    if (view === 'profit') return <ProfitWorkspace />;
    if (view === 'evidence') return <EvidenceWorkspace />;
    if (view === 'analyst') return <AnalystWorkspace />;
    if (view === 'scenario') return <ScenarioLab />;
    if (view === 'claims') return <ClaimAuditWorkspace />;
    if (view === 'health') {
      return <DataHealth health={health} refresh={() => void refreshCore()} busy={loadingCore} />;
    }
    return (
      <Overview
        health={health}
        capabilities={capabilities}
        platforms={platforms}
        launchpadRegistry={launchpadRegistry}
        onSearch={search}
        searchBusy={searchBusy}
      />
    );
  }, [
    view,
    searchResult,
    subject,
    launchInspection,
    launchError,
    searchBusy,
    searchError,
    search,
    inspect,
    health,
    loadingCore,
    refreshCore,
    capabilities,
    platforms,
    launchpadRegistry,
  ]);

  return (
    <div className="app-shell">
      <Header
        theme={theme}
        setTheme={setTheme}
        presentation={presentation}
        setPresentation={setPresentation}
        health={health}
      />
      <Sidebar view={view} setView={setView} />
      <main className="main-content">
        {coreError === undefined ? null : (
          <div className="alert alert-error api-alert">
            <strong>接口不可用</strong>
            <span>{coreError}</span>
            <button className="text-button" type="button" onClick={() => void refreshCore()}>
              重试
            </button>
          </div>
        )}
        {content}
        <footer>
          <span>ZeroTrace v0.1.0</span>
          <span>链上只读 · 多链取证</span>
          <a href="https://github.com/greywolf8888/ZeroTrace" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
