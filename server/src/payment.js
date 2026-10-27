const crypto = require('node:crypto');

function hmac(algorithm, secret, value) {
  return crypto.createHmac(algorithm, secret).update(value).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function vnpaySigningData(params) {
  return Object.keys(params)
    .filter(key => key.startsWith('vnp_') && key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType')
    .sort()
    .map(key => `${urlEncode(key)}=${urlEncode(params[key])}`)
    .join('&');
}

function urlEncode(value) {
  return encodeURIComponent(value).replace(/%20/g, '+').replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function vnpayQueryString(params) {
  return Object.keys(params).sort()
    .map(key => `${urlEncode(key)}=${urlEncode(params[key])}`)
    .join('&');
}

function signVnpay(params, secret) {
  return hmac('sha512', secret, vnpaySigningData(params));
}

function verifyVnpay(params, secret) {
  return Boolean(params.vnp_SecureHash) && safeEqual(signVnpay(params, secret), params.vnp_SecureHash);
}

function momoCreateSigningData(body, accessKey) {
  return [
    `accessKey=${accessKey}`,
    `amount=${body.amount}`,
    `extraData=${body.extraData || ''}`,
    `ipnUrl=${body.ipnUrl}`,
    `orderId=${body.orderId}`,
    `orderInfo=${body.orderInfo}`,
    `partnerCode=${body.partnerCode}`,
    `redirectUrl=${body.redirectUrl}`,
    `requestId=${body.requestId}`,
    `requestType=${body.requestType}`,
  ].join('&');
}

function momoCallbackSigningData(body, accessKey) {
  return [
    `accessKey=${accessKey}`,
    `amount=${body.amount}`,
    `extraData=${body.extraData || ''}`,
    `message=${body.message}`,
    `orderId=${body.orderId}`,
    `orderInfo=${body.orderInfo}`,
    `orderType=${body.orderType}`,
    `partnerCode=${body.partnerCode}`,
    `payType=${body.payType}`,
    `requestId=${body.requestId}`,
    `responseTime=${body.responseTime}`,
    `resultCode=${body.resultCode}`,
    `transId=${body.transId}`,
  ].join('&');
}

function signMomo(value, secret) {
  return hmac('sha256', secret, value);
}

function verifyMomo(body, accessKey, secret) {
  return Boolean(body.signature) && safeEqual(
    signMomo(momoCallbackSigningData(body, accessKey), secret),
    body.signature,
  );
}

module.exports = {
  momoCallbackSigningData,
  momoCreateSigningData,
  signMomo,
  signVnpay,
  verifyMomo,
  verifyVnpay,
  vnpayQueryString,
  vnpaySigningData,
};
