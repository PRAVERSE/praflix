/**
 * PRAFLIX Ingestion Pipeline V2 — Telegram Staging Reporter
 * A PRAVERSE Company
 *
 * Formats and dispatches high-fidelity Telegram notifications for V2 staging runs.
 * Explicitly states that the run is a STAGING RUN and that production is untouched.
 */

class TelegramV2Reporter {
  /**
   * @param {Object} [config]
   * @param {string} [config.botToken]
   * @param {string} [config.chatId]
   * @param {Function} [fetchFn]
   */
  constructor(config = {}, fetchFn = global.fetch) {
    this.botToken = config.botToken || null;
    this.chatId = config.chatId || null;
    this.fetch = fetchFn || global.fetch;
  }

  /**
   * Formats run result into PRAFLIX Telegram text
   * @param {Object} runResult
   * @returns {string}
   */
  formatReport(runResult) {
    const { runId, provider, timestampIst, status, evaluation, discovery } = runResult;

    const newTitlesCount = evaluation.newCanonicalTitles?.length || 0;
    const updatedCount = evaluation.existingTitlesUpdated?.length || 0;
    const dupCount = evaluation.duplicateRecords?.length || 0;
    const ambCount = evaluation.ambiguousRecords?.length || 0;
    const rejCount = evaluation.rejectedRecords?.length || 0;

    let text = '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '   PRAFLIX V2 STAGING REPORT\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
    text += `📡 Provider: ${provider.toUpperCase()}\n`;
    text += `🆔 Run ID: ${runId}\n`;
    text += `🕐 Time: ${timestampIst || new Date().toISOString()}\n`;
    text += `📊 Status: ${status}\n\n`;

    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += 'DISCOVERY & INGESTION\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += `🔍 Discovery Methods: ${discovery.methodsUsed?.join(', ') || 'N/A'}\n`;
    text += `📄 URLs Discovered: ${discovery.pagesDiscovered || 0}\n`;
    text += `✅ Successfully Parsed: ${discovery.successfullyParsed || 0}\n\n`;

    text += `🎬 New Canonical Titles: ${newTitlesCount}\n`;
    text += `🔄 Existing Titles Updated: ${updatedCount}\n`;
    text += `⏭️ Duplicate Records Skipped: ${dupCount}\n`;
    text += `❓ Ambiguous (Review Queue): ${ambCount}\n`;
    text += `🚫 Invalid Records Rejected: ${rejCount}\n\n`;

    if (newTitlesCount > 0) {
      text += '━━━━━━━━━━━━━━━━━━━━━━\n';
      text += 'NEW CANDIDATE PREVIEW\n';
      text += '━━━━━━━━━━━━━━━━━━━━━━\n';
      evaluation.newCanonicalTitles.slice(0, 5).forEach(t => {
        text += `• ${t.displayTitle} (${t.year || 'N/A'}) [${t.type}]\n`;
      });
      if (newTitlesCount > 5) {
        text += `...and ${newTitlesCount - 5} more titles\n`;
      }
      text += '\n';
    }

    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '🔒 PRODUCTION SAFETY\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '🛡️ Destination: praflix-testing/ingestion-v2/\n';
    text += '⚠️ Production Catalog: UNTOUCHED\n';

    return text;
  }

  /**
   * Dispatches the report to Telegram
   * @param {Object} runResult
   * @returns {Promise<{ success: boolean, skipped?: boolean, error?: string }>}
   */
  async sendReport(runResult) {
    const text = this.formatReport(runResult);

    if (!this.botToken || !this.chatId) {
      return {
        success: true,
        skipped: true,
        reason: 'Telegram credentials not provided in testing environment.',
        text
      };
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: text
        })
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { success: false, error: `Telegram HTTP ${res.status}: ${errText.slice(0, 100)}`, text };
      }

      return { success: true, text };
    } catch (err) {
      return { success: false, error: err.message, text };
    }
  }
}

module.exports = {
  TelegramV2Reporter
};
