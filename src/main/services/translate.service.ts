import translate from 'google-translate-api-x';

/**
 * Translate text using Google Translate (free, no API key needed).
 * Automatically detects source language and translates to target.
 */
export async function translateText(params: {
  text: string;
  targetLanguage: string;
}): Promise<{ translatedText: string; detectedLanguage: string }> {
  const { text, targetLanguage } = params;

  const res = await translate(text, { to: targetLanguage });

  // google-translate-api-x may return array for array input, but we always pass string
  const result = Array.isArray(res) ? res[0] : res;

  return {
    translatedText: result.text,
    detectedLanguage: result.from.language.iso,
  };
}
