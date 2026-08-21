import {
  api,
  type ControlCampaignRecord,
  type ControlCampaignMonitorResponse,
  type ForensicCaseBundleResponse,
  type ForensicCampaignAlert,
  type FundingSettlementReportResponse,
} from '../../generated-api/client.js';
import { zhUserMessage } from '../../i18n/zh-CN.js';
import { useEffect, useState } from 'react';
import type { CampaignGraphLayer } from './part-01.js';
import { nextMonitorStart, overlapPercent } from './part-01.js';

export function useControlCampaign() {
  const [chainId, setChainId] = useState('eip155:56');
  const [token, setToken] = useState('');
  const [records, setRecords] = useState<ControlCampaignRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [fundingSettlement, setFundingSettlement] = useState<FundingSettlementReportResponse>();
  const [fundingSettlementKey, setFundingSettlementKey] = useState<string>();
  const [fundingSettlementError, setFundingSettlementError] = useState<string>();
  const [fundingSettlementErrorKey, setFundingSettlementErrorKey] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [forensicCase, setForensicCase] = useState<ForensicCaseBundleResponse>();
  const [forensicCaseError, setForensicCaseError] = useState<string>();
  const [campaignAlerts, setCampaignAlerts] = useState<ForensicCampaignAlert[]>([]);
  const [alertsCampaignId, setAlertsCampaignId] = useState<string>();
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsError, setAlertsError] = useState<string>();
  const [monitor, setMonitor] = useState<ControlCampaignMonitorResponse>();
  const [monitorError, setMonitorError] = useState<string>();
  const [graphLayer, setGraphLayer] = useState<CampaignGraphLayer>('combined');

  const selected = records.find((record) => record.campaign.id === selectedId) ?? records[0];
  const selectedCampaignId = selected?.campaign.id;
  const comparisonReference =
    selected === undefined
      ? undefined
      : records.find((record) => record.campaign.id !== selected.campaign.id);

  useEffect(() => {
    if (selectedCampaignId === undefined) return;
    let active = true;
    void api
      .campaignAlerts(selectedCampaignId)
      .then((response) => {
        if (!active) return;
        setAlertsCampaignId(selectedCampaignId);
        setCampaignAlerts(response.alerts);
        setAlertsLoaded(true);
        setAlertsError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setAlertsCampaignId(selectedCampaignId);
        setCampaignAlerts([]);
        setAlertsLoaded(true);
        setAlertsError(
          zhUserMessage(cause instanceof Error ? cause.message : cause, '活动告警回放失败。'),
        );
      });
    return () => {
      active = false;
    };
  }, [selectedCampaignId]);

  const selectedFundingFromBlock =
    selected?.campaign.ledger === 'EVM' && selected.campaign.endBlock.state === 'known'
      ? selected.campaign.startBlock
      : undefined;
  const selectedFundingToBlock =
    selected?.campaign.ledger === 'EVM' &&
    selected.campaign.endBlock.state === 'known' &&
    typeof selected.campaign.endBlock.value === 'string'
      ? selected.campaign.endBlock.value
      : undefined;
  const selectedFundingChainId =
    selected?.campaign.ledger === 'EVM' ? selected.campaign.chainId : undefined;
  const selectedFundingToken =
    selected?.campaign.ledger === 'EVM' ? selected.campaign.token : undefined;
  const selectedFundingKey =
    selectedCampaignId !== undefined &&
    selectedFundingChainId !== undefined &&
    selectedFundingToken !== undefined &&
    selectedFundingFromBlock !== undefined &&
    selectedFundingToBlock !== undefined
      ? JSON.stringify([
          selectedCampaignId,
          selectedFundingChainId,
          selectedFundingToken,
          selectedFundingFromBlock,
          selectedFundingToBlock,
        ])
      : undefined;

  useEffect(() => {
    if (
      selectedFundingKey === undefined ||
      selectedFundingChainId === undefined ||
      selectedFundingToken === undefined ||
      selectedFundingFromBlock === undefined ||
      selectedFundingToBlock === undefined
    )
      return;
    let active = true;
    void api
      .fundingSettlementRange(
        selectedFundingChainId,
        selectedFundingToken,
        selectedFundingFromBlock,
        selectedFundingToBlock,
      )
      .then((response) => {
        if (!active) return;
        setFundingSettlement(response);
        setFundingSettlementKey(selectedFundingKey);
        setFundingSettlementError(undefined);
        setFundingSettlementErrorKey(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setFundingSettlement(undefined);
        setFundingSettlementKey(undefined);
        setFundingSettlementError(
          zhUserMessage(cause instanceof Error ? cause.message : cause, '资金与结算报告请求失败。'),
        );
        setFundingSettlementErrorKey(selectedFundingKey);
      });
    return () => {
      active = false;
    };
  }, [
    selectedFundingChainId,
    selectedFundingFromBlock,
    selectedFundingKey,
    selectedFundingToBlock,
    selectedFundingToken,
  ]);

  const visibleFundingSettlement =
    fundingSettlementKey === selectedFundingKey ? fundingSettlement : undefined;
  const visibleFundingSettlementError =
    fundingSettlementErrorKey === selectedFundingKey ? fundingSettlementError : undefined;

  const visibleAlerts =
    alertsCampaignId === selectedCampaignId ? campaignAlerts : ([] as ForensicCampaignAlert[]);
  const visibleAlertsLoaded = alertsCampaignId === selectedCampaignId && alertsLoaded;
  const visibleAlertsError = alertsCampaignId === selectedCampaignId ? alertsError : undefined;

  async function load() {
    const normalizedToken = token.trim();
    if (chainId.trim().length === 0 || normalizedToken.length === 0) return;
    setBusy(true);
    setError(undefined);
    const campaignResult = await Promise.allSettled([
      api.controlCampaigns(chainId.trim(), normalizedToken),
    ]).then(([result]) => result);
    if (campaignResult.status === 'fulfilled') {
      setRecords(campaignResult.value.records);
      setSelectedId(campaignResult.value.records[0]?.campaign.id);
      setGraphLayer('combined');
    } else {
      setError(
        zhUserMessage(
          campaignResult.reason instanceof Error
            ? campaignResult.reason.message
            : campaignResult.reason,
          '活动历史请求失败。',
        ),
      );
      setRecords([]);
      setSelectedId(undefined);
    }
    setLoaded(true);
    setBusy(false);
  }

  async function replay() {
    if (selected === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const replayed = await api.replayControlCampaign(selected.campaign.id);
      setRecords((current) => [
        replayed,
        ...current.filter((record) => record.campaign.id !== replayed.campaign.id),
      ]);
      setSelectedId(replayed.campaign.id);
    } catch (cause) {
      setError(zhUserMessage(cause instanceof Error ? cause.message : cause, '离线活动回放失败。'));
    } finally {
      setBusy(false);
    }
  }

  async function exportCase() {
    if (selected === undefined) return;
    setBusy(true);
    setError(undefined);
    setForensicCaseError(undefined);
    try {
      const response = await api.exportControlCampaign(selected.campaign.id);
      setForensicCase(response);
      const blob = new Blob([JSON.stringify(response.case, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${response.case.caseId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setForensicCase(undefined);
      setForensicCaseError(
        zhUserMessage(cause instanceof Error ? cause.message : cause, '取证案件包导出失败。'),
      );
    } finally {
      setBusy(false);
    }
  }

  const campaign = selected?.campaign;
  const evidenceLine = selected?.evidenceLine;
  const snapshotPosition =
    campaign?.snapshotEnd.blockNumber ??
    campaign?.snapshotEnd.height ??
    campaign?.snapshotEnd.slot ??
    '未知';
  const monitorStartBlock = nextMonitorStart(snapshotPosition);
  const showTokenLayer = graphLayer === 'combined' || graphLayer === 'token';
  const showFundingLayer = graphLayer === 'combined' || graphLayer === 'funding';
  const showSettlementLayer = graphLayer === 'combined' || graphLayer === 'settlement';
  const showBehaviorLayer = graphLayer === 'combined' || graphLayer === 'behavior';
  const visibleFundingLayer: 'combined' | 'funding' | 'settlement' =
    graphLayer === 'funding' || graphLayer === 'settlement' ? graphLayer : 'combined';
  const comparisonWalletOverlap =
    selected !== undefined && comparisonReference !== undefined
      ? overlapPercent(
          [...selected.campaign.coreWalletIds, ...selected.campaign.satelliteWalletIds],
          [
            ...comparisonReference.campaign.coreWalletIds,
            ...comparisonReference.campaign.satelliteWalletIds,
          ],
        )
      : undefined;
  const comparisonWalletDelta =
    selected !== undefined && comparisonReference !== undefined
      ? selected.campaign.coreWalletIds.length +
        selected.campaign.satelliteWalletIds.length -
        (comparisonReference.campaign.coreWalletIds.length +
          comparisonReference.campaign.satelliteWalletIds.length)
      : undefined;
  const comparisonEvidenceDelta =
    selected !== undefined && comparisonReference !== undefined
      ? selected.evidenceItems.length - comparisonReference.evidenceItems.length
      : undefined;

  async function startMonitor() {
    if (selected === undefined || monitorStartBlock === undefined) return;
    setBusy(true);
    setMonitorError(undefined);
    try {
      setMonitor(
        await api.createControlCampaignMonitor(
          chainId.trim(),
          selected.campaign.token,
          monitorStartBlock,
        ),
      );
    } catch (cause) {
      setMonitorError(
        zhUserMessage(cause instanceof Error ? cause.message : cause, '实时监控请求失败。'),
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    campaign,
    chainId,
    comparisonEvidenceDelta,
    comparisonReference,
    comparisonWalletDelta,
    comparisonWalletOverlap,
    error,
    evidenceLine,
    exportCase,
    forensicCase,
    forensicCaseError,
    graphLayer,
    load,
    loaded,
    monitor,
    monitorError,
    monitorStartBlock,
    records,
    replay,
    selected,
    selectedFundingChainId,
    selectedFundingFromBlock,
    selectedFundingToBlock,
    selectedFundingToken,
    selectedId,
    setChainId,
    setGraphLayer,
    setSelectedId,
    setToken,
    showBehaviorLayer,
    showFundingLayer,
    showSettlementLayer,
    showTokenLayer,
    snapshotPosition,
    startMonitor,
    token,
    visibleAlerts,
    visibleAlertsError,
    visibleAlertsLoaded,
    visibleFundingLayer,
    visibleFundingSettlement,
    visibleFundingSettlementError,
  };
}
