/** Slack section block `mrkdwn` text must be ≤ 3000 characters */
export const SLACK_MRKDWN_SECTION_MAX = 3000;

const TRUNCATE_SUFFIX = '\n…_(truncated)_';

/** Truncate mrkdwn for section blocks to stay within Slack limits */
export function truncateSlackMrkdwn(text: string, maxLen = SLACK_MRKDWN_SECTION_MAX): string {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - TRUNCATE_SUFFIX.length)) + TRUNCATE_SUFFIX;
}

/** True if `truncateSlackMrkdwn` would shorten the text */
export function slackMrkdwnWouldTruncate(text: string, maxLen = SLACK_MRKDWN_SECTION_MAX): boolean {
  if (!text) return false;
  return truncateSlackMrkdwn(text, maxLen) !== text;
}

/**
 * Split long mrkdwn into multiple Slack-safe chunks (prefer breaking at newlines).
 * Caps chunk count to avoid exceeding Slack's 50 blocks per message when combined with other UI.
 */
export function splitSlackMrkdwnIntoChunks(
  text: string,
  maxLen = SLACK_MRKDWN_SECTION_MAX,
  maxChunks = 24
): string[] {
  if (!text) return [];
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0 && chunks.length < maxChunks) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let sliceEnd = maxLen;
    const searchWindow = remaining.slice(0, maxLen);
    const lastNl = searchWindow.lastIndexOf('\n');
    if (lastNl > Math.floor(maxLen * 0.45)) {
      sliceEnd = lastNl + 1;
    }
    chunks.push(remaining.slice(0, sliceEnd));
    remaining = remaining.slice(sliceEnd);
  }
  if (remaining.length > 0 && chunks.length >= maxChunks) {
    const last = chunks[chunks.length - 1];
    chunks[chunks.length - 1] =
      last.slice(0, Math.max(0, last.length - 80)) +
      '\n\n…_(remaining text omitted; use the web app for the full explanation if needed)_';
  }
  return chunks;
}
