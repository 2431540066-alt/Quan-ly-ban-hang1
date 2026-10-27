const test = require('node:test');
const assert = require('node:assert/strict');
const { momoCallbackSigningData, signMomo, signVnpay, verifyMomo, verifyVnpay, vnpayQueryString, vnpaySigningData } = require('./payment');

test('VNPay signature validates only when signed fields are unchanged', () => {
  const params = { vnp_Amount: '10000', vnp_TxnRef: 'ref-1', ignored: 'x' };
  params.vnp_SecureHash = signVnpay(params, 'secret');
  assert.equal(verifyVnpay(params, 'secret'), true);
  assert.equal(verifyVnpay({ ...params, vnp_Amount: '20000' }, 'secret'), false);
  const spaced = { vnp_OrderInfo: 'Thanh toan don hang 1', vnp_TxnRef: '12' };
  assert.equal(vnpaySigningData(spaced), 'vnp_OrderInfo=Thanh+toan+don+hang+1&vnp_TxnRef=12');
  assert.equal(vnpayQueryString(spaced), vnpaySigningData(spaced));
});

test('MoMo callback signature validates only when callback fields are unchanged', () => {
  const body = {
    amount: '10000', extraData: '', message: 'Success', orderId: 'ref-1',
    orderInfo: 'Order', orderType: 'momo_wallet', partnerCode: 'partner',
    payType: 'qr', requestId: 'req-1', responseTime: '100',
    resultCode: 0, transId: 'tx-1',
  };
  body.signature = signMomo(momoCallbackSigningData(body, 'access'), 'secret');
  assert.equal(verifyMomo(body, 'access', 'secret'), true);
  assert.equal(verifyMomo({ ...body, amount: '20000' }, 'access', 'secret'), false);
});
