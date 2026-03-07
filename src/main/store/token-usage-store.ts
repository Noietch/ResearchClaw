import fs from 'fs';
import { ensureStorageDir, getStorageDir } from './storage-path';

export interface TokenUsageRecord {
  timestamp: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  kind: 'agent' | 'lightweight' | 'chat' | 'other';
}

export interface TokenUsageSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCalls: number;
  byProvider: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  byModel: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  byKind: Record<string, { prompt: number; completion: number; total: number; calls: number }>;
  lastUpdated: string | null;
}

function getTokenUsagePath(): string {
  return getStorageDir() + '/token-usage.json';
}

function loadRecords(): TokenUsageRecord[] {
  try {
    const path = getTokenUsagePath();
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, 'utf-8')) as TokenUsageRecord[];
    }
  } catch {
    // ignore
  }
  return [];
}

function saveRecords(records: TokenUsageRecord[]) {
  ensureStorageDir();
  const path = getTokenUsagePath();
  // Keep only last 1000 records to avoid unbounded growth
  const trimmed = records.slice(-1000);
  fs.writeFileSync(path, JSON.stringify(trimmed, null, 2), 'utf-8');
}

export function recordTokenUsage(record: TokenUsageRecord) {
  const records = loadRecords();
  records.push(record);
  saveRecords(records);
}

export function getTokenUsageSummary(): TokenUsageSummary {
  const records = loadRecords();

  const summary: TokenUsageSummary = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCalls: records.length,
    byProvider: {},
    byModel: {},
    byKind: {},
    lastUpdated: records.length > 0 ? records[records.length - 1].timestamp : null,
  };

  for (const record of records) {
    summary.totalPromptTokens += record.promptTokens;
    summary.totalCompletionTokens += record.completionTokens;
    summary.totalTokens += record.totalTokens;

    // By provider
    if (!summary.byProvider[record.provider]) {
      summary.byProvider[record.provider] = { prompt: 0, completion: 0, total: 0, calls: 0 };
    }
    summary.byProvider[record.provider].prompt += record.promptTokens;
    summary.byProvider[record.provider].completion += record.completionTokens;
    summary.byProvider[record.provider].total += record.totalTokens;
    summary.byProvider[record.provider].calls += 1;

    // By model
    const modelKey = `${record.provider}/${record.model}`;
    if (!summary.byModel[modelKey]) {
      summary.byModel[modelKey] = { prompt: 0, completion: 0, total: 0, calls: 0 };
    }
    summary.byModel[modelKey].prompt += record.promptTokens;
    summary.byModel[modelKey].completion += record.completionTokens;
    summary.byModel[modelKey].total += record.totalTokens;
    summary.byModel[modelKey].calls += 1;

    // By kind
    if (!summary.byKind[record.kind]) {
      summary.byKind[record.kind] = { prompt: 0, completion: 0, total: 0, calls: 0 };
    }
    summary.byKind[record.kind].prompt += record.promptTokens;
    summary.byKind[record.kind].completion += record.completionTokens;
    summary.byKind[record.kind].total += record.totalTokens;
    summary.byKind[record.kind].calls += 1;
  }

  return summary;
}

export function clearTokenUsage(): void {
  const path = getTokenUsagePath();
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}

export function getTokenUsageRecords(): TokenUsageRecord[] {
  return loadRecords();
}
