function todayVietnamDate(now = new Date()) {
  const date = new Date(now.getTime() + 7 * 36e5);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isExpired(expiryDate, now = new Date()) {
  return Boolean(expiryDate && new Date(expiryDate) < todayVietnamDate(now));
}

module.exports = { isExpired };
