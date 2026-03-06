function parseDate(value) {
  const ts = Date.parse(String(value || ""));
  if (Number.isNaN(ts)) return 0;
  return ts;
}

function pickWinnerLastWriteWins({ localRow, incomingRow }) {
  const localUpdatedAt = parseDate(localRow && localRow.updated_at);
  const incomingUpdatedAt = parseDate(incomingRow && incomingRow.updated_at);
  if (incomingUpdatedAt >= localUpdatedAt) {
    return "incoming";
  }
  return "local";
}

module.exports = { pickWinnerLastWriteWins };
