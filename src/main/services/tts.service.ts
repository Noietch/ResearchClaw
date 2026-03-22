import { EdgeTTS } from 'node-edge-tts';
import path from 'path';
import fs from 'fs/promises';
import { getStorageDir } from '../store/storage-path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TtsVoice {
  name: string;
  shortName: string;
  locale: string;
  gender: string;
}

export interface TtsSynthesizeParams {
  text: string;
  voice?: string;
  rate?: string;
  volume?: string;
  pitch?: string;
}

export interface TtsSubtitleWord {
  /** The word/fragment text */
  part: string;
  /** Start time in milliseconds */
  start: number;
  /** End time in milliseconds */
  end: number;
}

export interface TtsSynthesizeResult {
  audioDataUrl: string;
  subtitles: TtsSubtitleWord[];
}

// ─── Default voices per language ─────────────────────────────────────────────

const DEFAULT_VOICES: Record<string, string> = {
  en: 'en-US-AriaNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
};

// ─── State ──────────────────────────────────────────────────────────────────

let currentTts: EdgeTTS | null = null;
let aborted = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTtsCacheDir(): string {
  return path.join(getStorageDir(), 'tts-cache');
}

async function ensureTtsCacheDir(): Promise<string> {
  const dir = getTtsCacheDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Simple hash for cache key */
function hashText(text: string, voice: string, rate: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('md5').update(`${voice}:${rate}:${text}`).digest('hex');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Synthesize text to MP3 + subtitles via Edge TTS.
 * Returns base64 data URL and word-level timing for karaoke highlighting.
 */
export async function synthesizeText(params: TtsSynthesizeParams): Promise<TtsSynthesizeResult> {
  const { text, voice, rate = '+0%', volume = '+0%', pitch = '+0Hz' } = params;
  const resolvedVoice = voice || DEFAULT_VOICES['en'];

  const cacheDir = await ensureTtsCacheDir();
  const cacheKey = hashText(text, resolvedVoice, rate);
  const audioPath = path.join(cacheDir, `${cacheKey}.mp3`);
  const subsPath = path.join(cacheDir, `${cacheKey}.json`);

  let needSynthesize = true;
  try {
    await fs.access(audioPath);
    await fs.access(subsPath);
    needSynthesize = false;
  } catch {
    // Cache miss
  }

  if (needSynthesize) {
    aborted = false;
    const tts = new EdgeTTS({
      voice: resolvedVoice,
      rate,
      volume,
      pitch,
      timeout: 30000,
      saveSubtitles: true,
    });
    currentTts = tts;

    try {
      if (aborted) throw new Error('TTS aborted');
      await tts.ttsPromise(text, audioPath);
    } catch (e) {
      try {
        await fs.unlink(audioPath);
      } catch {}
      throw e;
    } finally {
      currentTts = null;
    }

    // node-edge-tts saves subtitles as <audioPath>.json
    // Move/copy to our naming scheme
    const generatedSubsPath = audioPath + '.json';
    try {
      const subsData = await fs.readFile(generatedSubsPath, 'utf-8');
      await fs.writeFile(subsPath, subsData);
      await fs.unlink(generatedSubsPath).catch(() => {});
    } catch {
      // No subtitles available — write empty array
      await fs.writeFile(subsPath, '[]');
    }
  }

  // Read both files
  const buffer = await fs.readFile(audioPath);
  const base64 = buffer.toString('base64');

  let subtitles: TtsSubtitleWord[] = [];
  try {
    const subsRaw = await fs.readFile(subsPath, 'utf-8');
    subtitles = JSON.parse(subsRaw) as TtsSubtitleWord[];
  } catch {
    // Subtitles unavailable
  }

  return {
    audioDataUrl: `data:audio/mpeg;base64,${base64}`,
    subtitles,
  };
}

/**
 * Abort any in-progress synthesis.
 */
export function stopSynthesis(): void {
  aborted = true;
  currentTts = null;
}

/**
 * Get the default voice for a language.
 */
export function getDefaultVoice(language: string): string {
  const lang = language.startsWith('zh') ? 'zh' : 'en';
  return DEFAULT_VOICES[lang] || DEFAULT_VOICES['en'];
}

/**
 * Return a curated list of popular voices for TTS.
 */
export function getVoiceList(): TtsVoice[] {
  return [
    // English
    { name: 'Aria (US Female)', shortName: 'en-US-AriaNeural', locale: 'en-US', gender: 'Female' },
    { name: 'Guy (US Male)', shortName: 'en-US-GuyNeural', locale: 'en-US', gender: 'Male' },
    {
      name: 'Jenny (US Female)',
      shortName: 'en-US-JennyNeural',
      locale: 'en-US',
      gender: 'Female',
    },
    {
      name: 'Sonia (UK Female)',
      shortName: 'en-GB-SoniaNeural',
      locale: 'en-GB',
      gender: 'Female',
    },
    { name: 'Ryan (UK Male)', shortName: 'en-GB-RyanNeural', locale: 'en-GB', gender: 'Male' },
    // Chinese
    {
      name: '晓晓 (女声)',
      shortName: 'zh-CN-XiaoxiaoNeural',
      locale: 'zh-CN',
      gender: 'Female',
    },
    { name: '云扬 (男声)', shortName: 'zh-CN-YunyangNeural', locale: 'zh-CN', gender: 'Male' },
    {
      name: '晓伊 (女声)',
      shortName: 'zh-CN-XiaoyiNeural',
      locale: 'zh-CN',
      gender: 'Female',
    },
    { name: '云希 (男声)', shortName: 'zh-CN-YunxiNeural', locale: 'zh-CN', gender: 'Male' },
    {
      name: '晓辰 (女声)',
      shortName: 'zh-CN-XiaochenNeural',
      locale: 'zh-CN',
      gender: 'Female',
    },
  ];
}

/**
 * Clean up old TTS cache files (older than 7 days).
 */
export async function cleanTtsCache(): Promise<void> {
  const cacheDir = getTtsCacheDir();
  try {
    const files = await fs.readdir(cacheDir);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.mp3') && !file.endsWith('.json')) continue;
      const filePath = path.join(cacheDir, file);
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > maxAge) {
        await fs.unlink(filePath);
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
}
