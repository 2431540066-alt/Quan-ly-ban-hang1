const transitions = Object.freeze({
  PENDING: Object.freeze(['CONFIRMED', 'CANCELLED']),
  CONFIRMED: Object.freeze(['SHIPPING', 'CANCELLED']),
  SHIPPING: Object.freeze(['PAID']),
  PAID: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});

function canTransition(current, next) {
  return transitions[current]?.includes(next) || false;
}

module.exports = { canTransition };
